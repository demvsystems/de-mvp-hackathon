# Zettel 5 — Clustering und Topic-Worker

Aus jedem neuen Embedding wird entweder eine Mitgliedschaft zu einem existierenden Topic abgeleitet oder ein neues Topic erzeugt. Online Nearest-Centroid-Strategie, mit pgvector als Storage und HNSW-Index für schnellen Lookup.

---

## Was

**Verantwortung.** Pro neuem Embedding einem Topic zuordnen oder ein neues erzeugen. Topic-Mitgliedschaft als `discusses`-Edge im Stream emittieren. Centroiden pro Topic inkrementell pflegen.

**Stack.**

- TypeScript/Node, ein Worker
- JetStream Durable Consumer mit Subject-Filter `events.embedding.created`
- Postgres mit `pgvector`-Extension
- HNSW-Index auf `topics.centroid_*` für Nearest-Centroid-Lookup

**Was er schreibt.**

- `topic.created`-Event bei neuem Topic
- `edge.observed`-Events mit `type=discusses` für Mitgliedschaft
- Direktes Update an `topics.centroid_*`-Spalten und `topics.member_count_*` (nicht via Materializer)

**Was er nicht schreibt.**

- Topic-Aktivitätsmetriken (das macht der Topic-Activity-Worker, separat)
- Topic-Bewertungen (das macht der LLM-Bewerter)

## Wie

### Algorithmus auf einen Blick

```
Pro neuem Embedding-Event:
  1. Embedding-Vektor + model_version aus Postgres laden
  2. Den nächsten Centroiden aus topics-Tabelle finden (HNSW-Lookup, nur active Topics)
  3. Wenn Distanz <= Schwelle → existierendes Topic, discusses-Edge schreiben
  4. Wenn Distanz > Schwelle → neues Topic erzeugen, discusses-Edge schreiben
  5. Centroid des Topics inkrementell aktualisieren
```

Online Nearest-Centroid. Pro Embedding ein Postgres-Lookup, eine UPSERT-Operation, ein Edge-Event publishen. Keine In-Memory-Cluster-Strukturen, keine periodischen Re-Cluster-Läufe.

### Centroiden parallel für beide Embedding-Strategien

Da der Embedding-Worker zwei Strategien parallel produziert (`body-only` und `with-neighbors`), pflegt der Topic-Worker pro Topic _zwei_ Centroiden — einen pro Strategie. Schema-Erweiterung an der `topics`-Tabelle:

```sql
ALTER TABLE topics
  ADD COLUMN centroid_body_only      vector(1536),
  ADD COLUMN centroid_with_neighbors vector(1536),
  ADD COLUMN member_count_body_only      integer NOT NULL DEFAULT 0,
  ADD COLUMN member_count_with_neighbors integer NOT NULL DEFAULT 0;

CREATE INDEX topics_centroid_body_only ON topics
  USING hnsw (centroid_body_only vector_cosine_ops)
  WHERE status = 'active' AND centroid_body_only IS NOT NULL;

CREATE INDEX topics_centroid_with_neighbors ON topics
  USING hnsw (centroid_with_neighbors vector_cosine_ops)
  WHERE status = 'active' AND centroid_with_neighbors IS NOT NULL;
```

Pro neues Embedding wird der passende Centroid (entsprechend der `model_version` im Event) aktualisiert. Damit sind beide Cluster-Räume parallel verfügbar.

**Wichtig: Topic-Identität ist gemeinsam.** Beide Strategien zeigen auf dieselben `topic:<uuid>`-Knoten — wenn das `body-only`-Embedding eines Records zu Topic X gehört und das `with-neighbors`-Embedding zu Topic Y, dann sind X und Y _verschiedene_ Topics. Das passiert genau dann, wenn die Strategien unterschiedliche Cluster-Strukturen ergeben — und das ist der A/B-Vergleichswert. Im Eval-Reasoning kann der Bewerter sehen "dieser Record gehört zu Topic X laut body-only, aber zu Topic Y laut with-neighbors" und das interpretieren.

### Topic-Lifecycle: direkt active

Bei Erzeugung wird ein Topic _sofort_ als `active` angelegt. Kein `proposed`-Zwischenschritt im Pilot. Begründung: der Pilot hat ohnehin nicht so viele Topics, dass eine zusätzliche Aktivierungs-Hürde Sinn ergäbe. Wenn sich Topics als zu kurzlebig erweisen (Single-Member-Topics, die schnell archiviert werden), kommt `proposed → active` in einer späteren Phase dazu.

Lifecycle-Übergänge im Pilot:

- Erzeugung: `active` (Topic-Worker schreibt direkt)
- Archivierung: `archived` (manuell oder Auto nach langer Dormancy in Phase 2)
- Merge: `superseded` (Curator-Aktion in Phase 2)

### Distanz-Metrik

Cosine-Distance über `<=>` (pgvector-Operator). Niedriger Wert = ähnlicher. Schwelle wird im Bauen ausprobiert — wahrscheinlicher Startwert 0.25–0.35, kalibriert anhand der synthetischen Goldstandard-Topics.

```sql
SELECT id, centroid_body_only <=> $1 AS distance
FROM topics
WHERE status = 'active'
  AND centroid_body_only IS NOT NULL
ORDER BY centroid_body_only <=> $1
LIMIT 1;
```

Schwelle wird über eine Config-Konstante geführt:

```typescript
const DISTANCE_THRESHOLDS = {
  'body-only:v1': 0.3, // Pilot-Default, im Bauen kalibriert
  'with-neighbors:v1': 0.25, // tendenziell strenger, weil Embedding mehr Kontext hat
};
```

Pro Strategie eigene Schwelle möglich, weil die Distanz-Verteilungen sich unterscheiden können — Embeddings mit Nachbarschafts-Kontext sind tendenziell ähnlicher zueinander, was eine strengere Schwelle rechtfertigt.

### Inkrementeller Mittelwert für Centroid

Bei jedem neuen Member wird der Centroid inkrementell aktualisiert:

```
neuer_centroid = ((bisheriger_centroid * member_count) + neues_embedding) / (member_count + 1)
```

In SQL:

```sql
UPDATE topics
SET centroid_body_only = (
      (centroid_body_only * member_count_body_only + $1::vector)
      / (member_count_body_only + 1)
    ),
    member_count_body_only = member_count_body_only + 1
WHERE id = $2;
```

pgvector unterstützt elementweise Multiplikation mit einem Skalar und Addition zwischen Vektoren — das funktioniert nativ.

Trade-off: der inkrementelle Mittelwert ist anfällig für _Drift_ bei sehr alten Topics. Ein Topic mit 1000 Mitgliedern, dessen erste 100 thematisch eng waren und dessen letzte 900 thematisch breit gedriftet sind, hat einen Centroid, der die ursprüngliche Enge nicht mehr widerspiegelt. Im Pilot mit überschaubarer Topic-Größe vernachlässigbar; in einer späteren Phase könnte ein Forgetting-Faktor (gewichteter Mittelwert mit höherem Gewicht für neue Members) das mildern.

### Worker-Loop

```typescript
const consumer = await js.consumers.get('EVENTS', 'topic-discovery');

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type !== 'embedding.created') {
      msg.ack();
      continue;
    }

    const payload = EmbeddingCreatedPayload.parse(envelope.payload);
    const strategy = parseStrategy(payload.model_version); // 'body-only' oder 'with-neighbors'

    await processEmbedding(payload, strategy);
    msg.ack();
  } catch (err) {
    log.error('topic-discovery error', err);
    msg.nak();
  }
}
```

### Pro Embedding: vier Schritte

```typescript
async function processEmbedding(payload: EmbeddingCreatedPayload, strategy: Strategy) {
  // 1. Vektor laden
  const { vector } = await db.queryOne(
    `SELECT vector FROM embeddings 
     WHERE record_id = $1 AND chunk_idx = $2 AND model_version = $3`,
    [payload.record_id, payload.chunk_idx, payload.model_version],
  );

  // 2. Nächsten Centroiden finden
  const centroidColumn =
    strategy === 'body-only' ? 'centroid_body_only' : 'centroid_with_neighbors';

  const nearest = await db.queryMaybeOne(
    `SELECT id, ${centroidColumn} <=> $1 AS distance
     FROM topics
     WHERE status = 'active'
       AND ${centroidColumn} IS NOT NULL
     ORDER BY ${centroidColumn} <=> $1
     LIMIT 1`,
    [vector],
  );

  // 3. Topic zuordnen oder neu erzeugen
  let topicId: string;
  const threshold = DISTANCE_THRESHOLDS[strategy];

  if (nearest && nearest.distance <= threshold) {
    topicId = nearest.id;
    await updateCentroidIncrementally(topicId, vector, strategy);
  } else {
    topicId = `topic:${uuidv4()}`;
    await createNewTopic(topicId, vector, strategy, payload);
  }

  // 4. discusses-Edge emittieren
  await publishDiscussesEdge(payload.record_id, topicId, strategy, nearest?.distance ?? 0);
}
```

### `discusses`-Edge-Format

```json
{
  "event_type": "edge.observed",
  "subject_id": "edge:discusses:slack:msg:T01ABC/C02DEF/1714028591.012345->topic:7c8d9e1f-2a3b-...",
  "source": "topic-discovery:body-only:v1",
  "payload": {
    "from_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "to_id": "topic:7c8d9e1f-2a3b-...",
    "type": "discusses",
    "source": "topic-discovery:body-only:v1",
    "confidence": 0.91,
    "valid_from": "2026-04-15T10:42:33.000Z",
    "valid_to": null
  },
  "evidence": {
    "cluster_distance": 0.09,
    "embedding_id": "embedding:slack:msg:...:0:openai-small-3:body-only:v1",
    "strategy": "body-only"
  },
  "causation_id": "evt_emb_a1b2c3"
}
```

`source` trägt die Strategie als Teil des Versions-Tags (`topic-discovery:body-only:v1` vs. `topic-discovery:with-neighbors:v1`). Das Multi-Source-Pattern in der `edges`-Tabelle erlaubt damit, dass derselbe Record über _zwei_ `discusses`-Edges zu _zwei verschiedenen_ Topics zugeordnet wird (wenn die Strategien sich unterscheiden) — beide Edges existieren parallel.

`confidence` aus der Cluster-Distanz: nahe Records haben hohe Confidence (z.B. 0.95 bei Distanz 0.05), Randmitglieder niedrigere (z.B. 0.7 bei Distanz 0.30). Konkrete Formel im Pilot: `confidence = 1.0 - (distance / threshold)`, geclampt auf [0, 1].

### Neue Topics anlegen

```typescript
async function createNewTopic(
  topicId: string,
  vector: number[],
  strategy: Strategy,
  trigger: EmbeddingCreatedPayload,
) {
  const centroidCol = strategy === 'body-only' ? 'centroid_body_only' : 'centroid_with_neighbors';
  const memberCol =
    strategy === 'body-only' ? 'member_count_body_only' : 'member_count_with_neighbors';

  // Neues Topic in Postgres anlegen — direkt active
  await db.query(
    `
    INSERT INTO topics (
      id, status, discovered_at, discovered_by,
      ${centroidCol}, ${memberCol}
    )
    VALUES ($1, 'active', now(), $2, $3, 1)
  `,
    [topicId, `topic-discovery:${strategy}:v1`, vector],
  );

  // topic.created-Event in Stream
  await publishEvent({
    event_type: 'topic.created',
    subject_kind: 'topic',
    subject_id: topicId,
    source: `topic-discovery:${strategy}:v1`,
    payload: {
      id: topicId,
      status: 'active',
      discovered_by: `topic-discovery:${strategy}:v1`,
      initial_centroid_summary: {
        sample_record_ids: [trigger.record_id],
        cluster_size: 1,
      },
    },
    correlation_id: topicId,
  });
}
```

Beachte: das Topic wird _direkt in Postgres_ angelegt, nicht über den Materializer-Umweg. Grund: der Topic-Worker braucht das Topic in der DB sofort verfügbar für den nächsten Embedding-Lookup (HNSW-Index). Ein Stream-Roundtrip wäre zu langsam und würde Race-Conditions zwischen aufeinander folgenden Embeddings ermöglichen.

Das `topic.created`-Event wird trotzdem emittiert, damit andere Worker (Activity-Worker, Bewerter) und der Postgres-Sink-Consumer informiert sind. Der Materializer behandelt das Event mit `INSERT ON CONFLICT DO NOTHING` — er sieht, dass das Topic schon da ist, und macht nichts.

Diese Doppel-Schreibung ist ein bewusster Bruch des "Materializer schreibt alle Tabellen"-Patterns. Begründet, weil Performance und Race-Freedom hier wichtiger sind als architektonische Reinheit.

### Centroid-Update mit Lock

Bei hoher Last könnte das inkrementelle Centroid-Update Race-Conditions haben — zwei parallele Embedding-Events könnten den Centroid gleichzeitig lesen und schreiben. Lösung: Postgres-Row-Lock für die Update-Operation:

```typescript
async function updateCentroidIncrementally(topicId: string, vector: number[], strategy: Strategy) {
  await db.transaction(async (tx) => {
    await tx.query(`SELECT 1 FROM topics WHERE id = $1 FOR UPDATE`, [topicId]);

    const centroidCol = strategy === 'body-only' ? 'centroid_body_only' : 'centroid_with_neighbors';
    const memberCol =
      strategy === 'body-only' ? 'member_count_body_only' : 'member_count_with_neighbors';

    await tx.query(
      `
      UPDATE topics
      SET ${centroidCol} = (${centroidCol} * ${memberCol} + $1::vector) / (${memberCol} + 1),
          ${memberCol} = ${memberCol} + 1
      WHERE id = $2
    `,
      [vector, topicId],
    );
  });
}
```

Im Pilot mit moderater Last selten relevant, aber das Pattern ist vorbereitet.

## Warum

**Warum Online Nearest-Centroid statt komplexerem Streaming-Clustering?** Konzeptionell sehr klar, in TypeScript ohne ML-Library-Krücken implementierbar, mit pgvector als nativer Storage. DenStream und ähnliche Verfahren würden zusätzliche Library-Abhängigkeiten und höhere Implementations-Komplexität bringen — für den Pilot überzogen. Trade-off: keine Forgetting-Mechanik im Algorithmus selbst, aber das ist im Pilot mit überschaubarer Topic-Lebenszeit vernachlässigbar.

**Warum direkt active statt proposed → active?** Im Pilot mit synthetischen Daten und überschaubarer Skala bringt der Aktivierungs-Schritt keinen Mehrwert. Er macht Sinn, wenn man Single-Record-Topics filtern will (Topic mit nur einem Member ist vielleicht nur ein Outlier) — aber das löst Phase 2 mit dediziertem Auto-Archive-Worker eleganter. Im Pilot bleibt der Lifecycle minimal.

**Warum zwei Centroiden pro Topic, nicht zwei separate Topic-Worker?** Wenn beide Strategien parallel laufen und unterschiedliche Topics erzeugen würden (was sie tun, wenn die Cluster-Strukturen sich unterscheiden), müssten sie sich auf gemeinsame Topic-IDs einigen — Race-Conditions wären unvermeidbar. Mit _einem_ Worker, der pro Embedding-Event entscheidet, in welchem Strategie-Raum er arbeitet, ist die Logik klar. Beide Strategien teilen sich die Topic-IDs — wenn ein Record laut beiden Strategien zum selben Cluster gehört, ist das _ein_ Topic, nicht zwei.

**Warum HNSW statt Brute-Force-Distanzberechnung?** Bei wenigen Topics (unter 100) wäre ein FullScan akzeptabel. Bei mehreren hundert oder tausend Topics wird HNSW deutlich schneller. Der Index-Aufwand ist gering, pgvector pflegt ihn automatisch. Pilot-pragmatisch nehmen wir es gleich mit.

**Warum Centroid direkt in Postgres updaten, nicht über Stream?** Latenz und Konsistenz. Wenn das Topic-Update über den Stream läuft, könnte das nächste Embedding eine veraltete Centroid-Sicht sehen, weil der Materializer noch nicht durchgelaufen ist. Direktes Postgres-Update macht den nachfolgenden Lookup sofort konsistent. Der Stream bekommt trotzdem ein `topic.created`-Event, damit andere Worker informiert sind.

**Warum Multi-Source-`discusses`-Edges parallel?** Der gesamte A/B-Vergleich der beiden Embedding-Strategien zahlt sich am Bewerter aus. Wenn beide Strategien dasselbe Topic finden, wachsen die Confidence-Werte addiert — der Bewerter hat starke Konsens-Signale. Wenn sie verschiedene Topics finden, sieht der Bewerter genau das im Reasoning. Beides wertvoll.

**Warum inkrementeller Mittelwert statt Re-Compute?** Re-Compute über alle Member wäre exakt, aber mit jedem neuen Member O(n)-Aufwand. Inkrementeller Mittelwert ist O(1) pro Update. Im Pilot mit überschaubarer Member-Anzahl Pilot-genug; bei sehr großen Topics in Produktion könnte periodischer Re-Compute (z.B. einmal pro Woche) als Korrektur sinnvoll werden.

**Warum kein Topic-Merge im Pilot?** Topic-Merge ist semantisch tricky — wann sind zwei Topics dasselbe? Der naive Heuristik-Ansatz (zwei Topics, deren Centroiden nahe sind, mergen) führt zu Eskalations-Kaskaden, in denen alle Topics am Ende ein einziges großes Topic sind. Sauberer Topic-Merge braucht Curator-UI oder ausgereifte Heuristiken — beides Phase 2.

## Beispiele

### Beispiel: Erste Records eines neuen BiPro-Topics

Drei Slack-Messages über drei Tage, die alle BiPro 430.4 thematisieren. Jede produziert zwei Embeddings (body-only und with-neighbors).

**Tag 1, Message 1 — der allererste BiPro-Bezug:**

Beim body-only-Embedding findet der Topic-Worker keinen passenden Centroid (alle existierenden Topics haben Distanz > 0.30). Neues Topic wird angelegt:

```sql
INSERT INTO topics (id, status, discovered_at, discovered_by,
                    centroid_body_only, member_count_body_only)
VALUES ('topic:7c8d9e1f-...', 'active', now(), 'topic-discovery:body-only:v1',
        '[0.0613, -0.089, 0.054, ...]', 1);
```

`discusses`-Edge wird emittiert:

```
slack:msg:T01ABC/C02DEF/M1.001 → topic:7c8d9e1f-...
type: discusses, source: topic-discovery:body-only:v1, confidence: 1.00
```

(Confidence 1.0, weil der allererste Member exakt dem Centroid entspricht.)

Beim with-neighbors-Embedding ähnlich, eventuell wird _dasselbe_ Topic genutzt, falls der HNSW-Lookup auf `centroid_with_neighbors` ein passendes findet. Falls nicht, neues Topic — die beiden Strategien können also unterschiedliche Topics erzeugen.

**Tag 2, Message 2 — semantisch ähnlich:**

Body-only-Embedding hat Distanz 0.18 zum Topic-Centroid → unter Schwelle 0.30. Topic-Mitgliedschaft, Centroid-Update:

```sql
SELECT centroid_body_only, member_count_body_only FROM topics WHERE id = 'topic:7c8d9e1f-...';
-- centroid: [0.0613, -0.089, 0.054, ...], member_count: 1

UPDATE topics
SET centroid_body_only = (centroid_body_only * 1 + '[0.0512, -0.092, 0.068, ...]'::vector) / 2,
    member_count_body_only = 2
WHERE id = 'topic:7c8d9e1f-...';
-- neuer centroid: [0.0563, -0.0905, 0.061, ...]
```

`discusses`-Edge mit Confidence 1 - (0.18/0.30) = 0.40:

```
slack:msg:T01ABC/C02DEF/M2.001 → topic:7c8d9e1f-...
type: discusses, source: topic-discovery:body-only:v1, confidence: 0.40
```

**Tag 3, Message 3 — mit Bezug zu Jira-Ticket:**

Wieder sehr ähnlich, kommt zum selben Topic. Centroid weiter eingependelt. Confidence wieder hoch.

Nach drei Tagen hat das Topic in Postgres:

```
id                           | status | discovered_by                      | centroid_body_only          | member_count_body_only
─────────────────────────────┼────────┼────────────────────────────────────┼─────────────────────────────┼────────────────────────
topic:7c8d9e1f-2a3b-...       | active | topic-discovery:body-only:v1       | [0.0589, -0.0901, 0.062, …]  | 3
```

Drei `discusses`-Edges in der `edges`-Tabelle, alle vom Source-Tag `topic-discovery:body-only:v1`, mit unterschiedlichen Confidences je nach Cluster-Distanz.

### Beispiel: Strategie-Divergenz

Ein Slack-Reply, der nur zwei Worte enthält ("Ja, sehe ich auch so."), bekommt:

- body-only-Embedding: thematisch unspezifisch, Distanz zu allen Topic-Centroiden > 0.50 → neues Single-Member-Topic
- with-neighbors-Embedding: enthält Thread-Parent-Kontext, der über BiPro spricht, Distanz zum BiPro-Topic < 0.30 → wird zugeordnet

Resultat: zwei Edges für denselben Record, zu zwei verschiedenen Topics:

```
slack:msg:M.reply.001 → topic:7c8d9e1f-... (BiPro)
  type: discusses, source: topic-discovery:with-neighbors:v1, confidence: 0.55

slack:msg:M.reply.001 → topic:9d2e3f4g-... (single-member, kein klares Thema)
  type: discusses, source: topic-discovery:body-only:v1, confidence: 1.00
```

Genau das ist der A/B-Vergleichswert: die Strategie mit Nachbarschafts-Kontext erkennt das thematische Anliegen, die Body-only-Strategie sieht nur leere Zustimmung. Im Bewerter-Reasoning kann das später sichtbar werden.

### Beispiel: HNSW-Lookup-Performance

Bei 500 aktiven Topics dauert ein HNSW-Lookup mit pgvector typisch 1–3 ms. Bei 5000 Topics typisch 5–10 ms. Im Pilot mit unter 200 Topics ist Lookup-Latenz vernachlässigbar.

```sql
EXPLAIN ANALYZE
SELECT id, centroid_body_only <=> '[0.05, -0.09, ...]'::vector AS distance
FROM topics
WHERE status = 'active' AND centroid_body_only IS NOT NULL
ORDER BY centroid_body_only <=> '[0.05, -0.09, ...]'::vector
LIMIT 1;

-- Index Scan using topics_centroid_body_only on topics
--   Order By: (centroid_body_only <=> '[...]'::vector)
-- Execution Time: 1.823 ms
```

## Cross-Links

- Was im Stream ankommt: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Wer Embeddings produziert: [Zettel 4 — Embedding](./04_embedding.md)
- Wo `discusses`-Edges materialisiert werden: [Zettel 3 — Materialisierer](./03_materialisierer.md)
- Wer auf Topics liest: [Zettel 6 — Tool-Layer](./06_tool_layer.md)
