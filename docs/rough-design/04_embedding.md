# Zettel 4 — Embedding

Pro Record einen oder mehrere Vektor-Repräsentationen erzeugen. Im Pilot mit zwei parallelen Strategien, um später A/B-vergleichen zu können: einfaches Title+Body-Embedding und Nachbarschafts-angereichertes Embedding.

---

## Was

**Verantwortung.** Pro neuem Record einen Embedding-Vektor erzeugen, optional mit Nachbarschafts-Kontext, und in `embeddings`-Tabelle schreiben. Bei Updates am Record oder wenn Nachbarn nachträglich ankommen: erneuern.

**Stack.**

- TypeScript/Node, eigener Worker
- JetStream Durable Consumer mit Subject-Filter `events.record.observed.>` und `events.record.updated.>`
- HTTP-Client für Embedding-API (Default-Kandidat: `openai/text-embedding-3-small`, 1536 Dimensionen, im Spike final entschieden)
- Postgres mit `pgvector`-Extension

**Was er schreibt.**

- `embeddings`-Tabelle, mit `model_version` und `chunk_idx` als Teil des Primary Keys
- `events.embedding.created`-Event für jeden geschriebenen Vektor (Topic-Worker reagiert darauf)

**Was er nicht schreibt.**

- `records` oder `edges` — das ist Materializer-Aufgabe
- `topics` — das macht der Topic-Worker

## Wie

### Zwei parallele Embedding-Strategien

Im Pilot werden pro Record _zwei_ Embeddings erzeugt, parallel gespeichert mit unterschiedlichen `model_version`-Tags. Damit ist A/B-Vergleich der Strategien direkt möglich, ohne dass eine Migration nötig wäre, wenn sich eine als besser herausstellt.

**Strategie A — Body only.**

- `model_version: "openai-small-3:body-only:v1"`
- Input: `title + "\n\n" + body` (mit fallback wenn title null)
- Ein Embedding pro Record (Chunking siehe unten)

**Strategie B — Mit Nachbarschafts-Kontext.**

- `model_version: "openai-small-3:with-neighbors:v1"`
- Input: Knoten-Text + Nachbar-Texte konkateniert
- Welche Nachbarn einbezogen werden, ist offen — siehe Diskussion unten

Beide Strategien laufen parallel. Der Topic-Worker und `find_similar` können später wählen, welche `model_version` sie nutzen — Default im Pilot ist Strategie A, Strategie B wird im Eval-Vergleich ausgewertet.

### Welche Nachbarn — offene Frage, pragmatisch starten

Die Frage "welche Nachbarn ergänzen den Knoten-Text sinnvoll" ist nicht trivial und hängt vom Record-Typ ab. Pragmatischer Pilot-Default mit Beobachtung:

| Record-Typ                | Vorgeschlagene Nachbarn                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Slack-Message (Top-Level) | bis zu 3 ältere Messages im selben Channel innerhalb 1h davor (Kontext der Diskussion) |
| Slack-Reply               | Thread-Parent + ggf. ein Sibling-Reply davor                                           |
| GitHub-Issue              | bis zu 3 letzte Comments am Issue                                                      |
| GitHub-PR                 | Issue-Body, das es schließt (über `references`-Edge)                                   |
| Jira-Issue                | Parent-Issue (bei Subtask), bis zu 3 letzte Comments                                   |
| Confluence-Page           | Parent-Page-Title + erster Absatz                                                      |
| Confluence-Comment        | Parent-Page-Title + Body                                                               |

Diese Liste ist _Vorschlag_, kein Gesetz. Der Worker liest die Nachbarn beim Embedding-Build aus den Read-Tabellen (`records` und `edges`). Wenn ein vorgeschlagener Nachbar zur Embedding-Zeit noch nicht da ist (Backfill-Reihenfolge), wird er ausgelassen — beim nächsten Update kommt er dazu.

Token-Budget pro Embedding: typisch 8K Tokens (OpenAI-Limit). Bei vielen Nachbarn vorab-Truncation: Knoten-Text bekommt Priorität, Nachbarn werden gekürzt oder ausgelassen wenn das Budget überschritten wird.

### Zeitliche Strategie — event-driven mit späterer Erneuerung

Das Embedding wird event-driven gebaut, sobald ein Record da ist. Es kann später erneuert werden, wenn neue Nachbarn dazu kommen — der Worker hört zusätzlich auf `events.edge.observed`-Events, die einen Record als Nachbarn betreffen.

```
Zeitpunkt T0: Slack-Reply kommt rein (record.observed)
  → Embedding A (body only) wird erzeugt
  → Embedding B (mit Nachbarn) wird erzeugt — falls Thread-Parent schon da ist

Zeitpunkt T1: Thread-Parent ingestiert nachträglich (etwa durch Backfill)
  → edge.observed: replies_to (causation für Reply)
  → Worker prüft: hat der Reply schon ein Embedding B mit diesem Nachbarn?
  → Wenn nein: Embedding B neu bauen mit Parent-Kontext

Zeitpunkt T2: Neuer Reply auf denselben Thread
  → Worker erkennt: die Sibling-Replies des Original-Reply haben sich geändert
  → Optional: Embedding B des Original-Reply neu bauen
```

Im Pilot bleibt das _einfach_ — bei Strategie B wird das Embedding einmal erzeugt und nur dann erneuert, wenn ein direkter struktureller Nachbar ankommt. Periodisches Re-Embedding wegen sich ändernder Sibling-Reply-Mengen ist nicht im Pilot.

### Chunking

Pragmatischer Pilot-Default: kein Chunking. Lange Records (Confluence-Pages, lange Issue-Bodies) werden auf 8K Tokens gekürzt — der Anfang bekommt Priorität.

Wenn sich im Eval zeigt, dass langer Content systematisch schlecht ingest, kommt Chunking dazu. Dann pro Record mehrere Zeilen in `embeddings` mit aufsteigendem `chunk_idx`. Das Schema unterstützt es bereits (Primary Key: `(record_id, chunk_idx, model_version)`), nur die Build-Logik muss erweitert werden.

### Worker-Loop

```typescript
const consumer = await js.consumers.get('EVENTS', 'embedder');

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type === 'record.observed' || envelope.event_type === 'record.updated') {
      const payload = RecordObservedPayload.parse(envelope.payload);

      // Skip Container und User-Knoten
      if (['channel', 'repo', 'project', 'database', 'space', 'user'].includes(payload.type)) {
        msg.ack();
        continue;
      }

      // Strategie A: Body only
      await embedRecord(payload, 'body-only');

      // Strategie B: Mit Nachbarn
      await embedRecord(payload, 'with-neighbors');
    }

    if (envelope.event_type === 'edge.observed') {
      // Wenn struktureller Nachbar ankommt, Strategie-B-Embedding der involvierten Records ggf. erneuern
      await maybeRefreshNeighborEmbeddings(envelope);
    }

    msg.ack();
  } catch (err) {
    log.error('embedder error', err);
    msg.nak();
  }
}
```

### Pro Embedding: drei Schritte

1. **Input-Text bauen.** Bei Strategie A: `title + body`. Bei Strategie B: zusätzlich Nachbarn aus Postgres laden und konkatenieren mit klaren Trennern (z.B. `\n\n--- context ---\n\n`).

2. **API-Call.** HTTP-Request an Embedding-API. Retry mit exponential backoff bei 429/5xx. Bei dauerhaftem Fehler: NAK und Stream redelivered.

3. **In Postgres schreiben + Event emittieren.**

```typescript
async function embedRecord(
  payload: RecordObservedPayload,
  strategy: 'body-only' | 'with-neighbors',
) {
  const modelVersion = `openai-small-3:${strategy}:v1`;

  // Idempotenz-Check
  const existing = await db.query(
    `SELECT 1 FROM embeddings WHERE record_id = $1 AND chunk_idx = 0 AND model_version = $2`,
    [payload.id, modelVersion],
  );
  if (existing.rowCount > 0 && strategy === 'body-only') {
    // Body-only ist deterministisch; bei Update kommt sowieso neuer call durch updated_at-Check
    return;
  }

  const text =
    strategy === 'body-only' ? buildBodyOnlyText(payload) : await buildWithNeighborsText(payload);

  const truncated = truncateToTokenLimit(text, 8000);
  const vector = await embedAPI.embed(truncated, 'text-embedding-3-small');

  await db.query(
    `
    INSERT INTO embeddings (record_id, chunk_idx, chunk_text, model_version, vector, generated_at)
    VALUES ($1, 0, $2, $3, $4, now())
    ON CONFLICT (record_id, chunk_idx, model_version) DO UPDATE
      SET chunk_text   = EXCLUDED.chunk_text,
          vector       = EXCLUDED.vector,
          generated_at = EXCLUDED.generated_at
  `,
    [payload.id, truncated, modelVersion, vector],
  );

  await publishEvent({
    event_type: 'embedding.created',
    subject_kind: 'embedding',
    subject_id: `embedding:${payload.id}:0:${modelVersion}`,
    payload: {
      record_id: payload.id,
      chunk_idx: 0,
      model_version: modelVersion,
    },
  });
}
```

### Idempotenz und Re-Embedding

- Bei `record.observed` mit unverändertem Inhalt (gleicher `updated_at`): kein Re-Embedding (Skip-Pfad oben).
- Bei `record.updated` mit neuem `updated_at`: beide Strategien erneuert.
- Bei neuem Nachbarn (über `edge.observed`): nur Strategie B betroffen, gezielt erneuern.
- Bei Modell-Wechsel: neue `model_version`, neue Embeddings parallel. Alte werden nicht gelöscht — Roll-back möglich.

### Subject-Routing für Embedding-Events

Der Topic-Worker hört auf `events.embedding.created`. Damit beide Embedding-Strategien getrennt verarbeitbar sind, kann das Subject erweitert werden:

```
events.embedding.created.body-only
events.embedding.created.with-neighbors
```

Im Pilot startet der Topic-Worker mit `events.embedding.created.body-only` als Default. Bei Bedarf zweiter Topic-Worker auf `events.embedding.created.with-neighbors` — beide schreiben in dieselbe `topics`-Tabelle, aber mit unterschiedlichen `discovered_by`-Tags (`topic-discovery:body-only:v1` vs. `topic-discovery:with-neighbors:v1`).

## Warum

**Warum zwei parallele Strategien?** Die Hypothese, dass Nachbarschafts-Kontext bessere Embeddings produziert, ist plausibel aber empirisch offen. Indem beide Varianten parallel laufen, kann der Pilot diese Hypothese direkt testen — Topic-Discovery, `find_similar` und Bewerter-Eval lassen sich pro Strategie auswerten. Ohne diese Doppelung müsste man die Hypothese im Spike entscheiden, mit unsicherer Datengrundlage.

**Warum text-embedding-3-small als Default-Kandidat?** Gut verfügbar via OpenAI-API, niedrige Kosten ($0.02/1M Tokens), 1536 Dimensionen sind für unsere Use-Cases ausreichend, deutsche Texte werden gut behandelt. Voyage-3 wäre die Alternative mit ähnlichen Eigenschaften und etwas besserer Domain-Adaption für Tech-Texte. Im Spike final entschieden.

**Warum event-driven statt scheduled?** Der Topic-Worker hängt direkt am Embedding-Output — Latenz vom Record bis zum Embedding sollte gering sein. Mit event-driven typisch Sub-Sekunden, mit scheduled Job (etwa alle 5 Min) wäre der Topic-Lookup verzögert. Bei moderater Last ist event-driven günstiger.

**Warum Strategie B nur bei strukturellen Nachbarn re-embedden?** Re-Embedding kostet API-Calls. Sibling-Reply-Veränderungen sind häufig (jeder neue Reply ändert die Sibling-Menge), aber semantisch oft marginal. Strukturelle Nachbarn (Thread-Parent, Page-Parent, Issue-Parent) sind seltener und semantisch zentraler. Pragmatischer Cut: nur bei strukturellen Edges re-embedden, periodisches Re-Embedding wegen Sibling-Drift in Phase 2.

**Warum Truncation statt Chunking im Pilot?** Chunking erfordert mehr Embedding-Calls und macht Topic-Discovery komplexer (welcher Chunk gehört zu welchem Topic?). Bei den meisten Records reicht Truncation auf 8K Tokens — Slack-Messages und GitHub-Issues sind selten länger. Confluence-Pages können länger sein, aber der Anfang einer Page enthält typischerweise das wesentliche Thema. Wenn Eval zeigt, dass das nicht reicht, kommt Chunking dazu.

**Warum `model_version` als Teil des Primary Keys?** Strategie-Wechsel und Modell-Updates sind realistisch. Mit `model_version` im PK können verschiedene Embeddings pro Record nebeneinander existieren — A/B-Vergleich, Roll-back, sanfter Migrations-Pfad. Ohne diese Trennung müsste eine Migration alle alten Embeddings löschen, was Eval-Reproduzierbarkeit zerstört.

**Warum Container und User-Knoten skippen?** Container haben keinen sinnvollen Body, User-Knoten kein Diskussions-Inhalt. Embeddings für sie wären leeres Rauschen und würden Topic-Discovery verschlechtern. Skip-Pfad ist explizit im Worker.

**Warum Strategie-Output als getrennte Subjects?** Damit der Topic-Worker sich entscheiden kann, welche Strategie er konsumiert, ohne im Worker selbst zu filtern. Sauber im Routing-Layer.

## Beispiele

### Beispiel: Strategie A — Body only für Slack-Reply

Input zum API:

```
[ID: slack:msg:T01ABC/C02DEF/1714028591.012345]

Stimmt — und der gleiche Einwand kam letzte Woche schon. Ist das DEMV-4127?
```

API-Call:

```typescript
const res = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  }),
});
const {
  data: [{ embedding }],
} = await res.json();
```

Postgres-Eintrag:

```
record_id                                       | chunk_idx | model_version                    | vector (gekürzt)             | generated_at
────────────────────────────────────────────────┼───────────┼──────────────────────────────────┼──────────────────────────────┼─────────────────────────
slack:msg:T01ABC/C02DEF/1714028591.012345       | 0         | openai-small-3:body-only:v1      | [0.0421, -0.118, 0.0731, …]  | 2026-04-15 09:23:16+00
```

### Beispiel: Strategie B — Mit Nachbarschafts-Kontext

Worker baut den Input-Text:

```typescript
async function buildWithNeighborsText(payload: RecordObservedPayload): Promise<string> {
  const parts: string[] = [];

  // Knoten-Text
  parts.push(`[ID: ${payload.id}]`);
  if (payload.title) parts.push(payload.title);
  if (payload.body) parts.push(payload.body);

  // Nachbarn nach Record-Typ
  if (payload.type === 'message' && payload.payload.thread_ts) {
    const parent = await loadThreadParent(payload);
    if (parent) parts.push(`\n--- Thread-Parent ---\n${parent.body}`);
  }

  if (payload.type === 'issue') {
    const recentComments = await loadRecentComments(payload.id, 3);
    if (recentComments.length > 0) {
      parts.push(`\n--- Recent Comments ---`);
      for (const c of recentComments) parts.push(c.body);
    }
  }

  // Weitere Record-Typen analog

  return parts.join('\n');
}
```

Postgres-Eintrag:

```
record_id                                       | chunk_idx | model_version                          | vector (gekürzt)             | generated_at
────────────────────────────────────────────────┼───────────┼────────────────────────────────────────┼──────────────────────────────┼─────────────────────────
slack:msg:T01ABC/C02DEF/1714028591.012345       | 0         | openai-small-3:body-only:v1            | [0.0421, -0.118, 0.0731, …]  | 2026-04-15 09:23:16+00
slack:msg:T01ABC/C02DEF/1714028591.012345       | 0         | openai-small-3:with-neighbors:v1       | [0.0512, -0.092, 0.0681, …]  | 2026-04-15 09:23:18+00
```

Beide Embeddings nebeneinander, getrennt über `model_version`.

### Beispiel: `find_similar`-Query

```sql
-- Strategie A
SELECT record_id, 1 - (vector <=> $1) AS similarity
FROM embeddings
WHERE model_version = 'openai-small-3:body-only:v1'
ORDER BY vector <=> $1
LIMIT 10;

-- Strategie B parallel
SELECT record_id, 1 - (vector <=> $1) AS similarity
FROM embeddings
WHERE model_version = 'openai-small-3:with-neighbors:v1'
ORDER BY vector <=> $1
LIMIT 10;
```

Tool-Layer kann beide Strategien parallel auswerten und die Differenz im Reasoning sichtbar machen.

### Beispiel: emittiertes Embedding-Event

Subject: `events.embedding.created.body-only`

```json
{
  "event_id": "evt_emb_a1b2c3",
  "event_type": "embedding.created",
  "schema_version": 1,
  "occurred_at": "2026-04-15T09:23:16.000Z",
  "observed_at": "2026-04-15T09:23:16.124Z",
  "source": "embedder:v1",
  "subject_kind": "embedding",
  "subject_id": "embedding:slack:msg:T01ABC/C02DEF/1714028591.012345:0:openai-small-3:body-only:v1",
  "payload": {
    "record_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "chunk_idx": 0,
    "model_version": "openai-small-3:body-only:v1"
  },
  "causation_id": "evt_a3f9c8d2e7b1",
  "correlation_id": null
}
```

Vektor selbst wird _nicht_ im Event mitgeschickt — er ist groß, lebt in Postgres, andere Worker laden ihn von dort.

## Cross-Links

- Was im Stream ankommt: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Wer die Records produziert: [Zettel 2 — Connectors](./02_connectors.md)
- Wer auf Embeddings wartet: [Zettel 5 — Clustering](./05_clustering.md)
- `find_similar` als Konsument: [Zettel 6 — Tool-Layer](./06_tool_layer.md)
