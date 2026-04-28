# Zettel 3 — Materialisierer und Datenmodell

Der Materializer übersetzt den Event-Stream in queryables State. Aus "alles ist aufgezeichnet" wird "alles ist abfragbar". Im Pilot ein einziger Worker, der pro Event in die passende Tabelle schreibt.

---

## Was

**Verantwortung.** Konsumiert den Event-Stream und schreibt strukturelle Tabellen. Ein einziger TypeScript-Worker mit Subject-Filter `events.>` (sieht alles).

**Was er schreibt.**

- `records` (Quell-Artefakte und Container)
- `users` (User-Knoten pro Quelle)
- `edges` (alle Edge-Klassen — strukturell, inferiert, Topic-Mitgliedschaft)
- `topics` (Status, Lifecycle, Metadaten — _nicht_ Aktivitätsmetriken)
- `topic_assessments` (LLM-Bewerter-Outputs)

**Was er nicht schreibt.**

- `embeddings` — das macht der Embedding-Worker direkt
- `topics`-Aktivitäts-Spalten (`velocity_24h`, `stagnation_severity` etc.) — das macht der Topic-Activity-Worker direkt

**Stack.**

- TypeScript/Node
- `@nats-io/jetstream` als Durable Consumer
- `pg` oder `postgres` für Postgres-Zugriff
- Postgres mit `pgvector`-Extension

## Wie

### Der Hauptloop

Subject-Filter `events.>`, Subject-Routing per Switch:

```typescript
for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    switch (envelope.event_type) {
      case 'record.observed':
      case 'record.updated':
        await handleRecordObserved(envelope);
        break;
      case 'record.deleted':
        await handleRecordDeleted(envelope);
        break;
      case 'edge.observed':
        await handleEdgeObserved(envelope);
        break;
      case 'topic.created':
        await handleTopicCreated(envelope);
        break;
      case 'topic.activated':
        await handleTopicActivated(envelope);
        break;
      case 'topic.archived':
        await handleTopicArchived(envelope);
        break;
      case 'topic.assessment.created':
        await handleAssessmentCreated(envelope);
        break;
      // embedding.created, system.* werden ignoriert
      default:
        break;
    }

    msg.ack();
  } catch (err) {
    log.error('materializer error', { err, event_id: envelope?.event_id });
    msg.nak();
  }
}
```

Jedes Event in eigener Postgres-Transaction. Kein Batching im Pilot — einfacher zu testen, ausreichend für Pilot-Durchsatz.

### Datenmodell

Sieben Tabellen, alle mit deterministischen IDs.

#### records

```sql
CREATE EXTENSION IF NOT EXISTS pgvector;

CREATE TABLE records (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  source        text NOT NULL,
  title         text,
  body          text,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  ingested_at   timestamptz NOT NULL,
  is_deleted    boolean NOT NULL DEFAULT false,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('german', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('german', coalesce(body, '')), 'B')
  ) STORED
);

CREATE INDEX records_source_type ON records(source, type);
CREATE INDEX records_updated     ON records(updated_at DESC);
CREATE INDEX records_search      ON records USING GIN(search_vector);
CREATE INDEX records_payload_gin ON records USING GIN(payload);
```

`search_vector` ist Generated Column — Postgres pflegt sie automatisch beim INSERT/UPDATE. Damit muss der Materializer keinen separaten Code für FTS schreiben.

`is_deleted` ist Soft-Delete-Flag. Records werden nie aus der Tabelle entfernt, nur markiert.

#### users

```sql
CREATE TABLE users (
  id            text PRIMARY KEY,
  source        text NOT NULL,
  display_name  text,
  email         text,
  is_bot        boolean NOT NULL DEFAULT false,
  is_external   boolean NOT NULL DEFAULT false,
  payload       jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL
);

CREATE INDEX users_source ON users(source);
CREATE INDEX users_email  ON users(email) WHERE email IS NOT NULL;
```

User-Knoten kommen über `record.observed`-Events mit `type='user'`. Der Materializer routet sie in diese Tabelle statt in `records` — eigene Tabelle, weil User andere Aktualisierungs-Patterns haben (häufige Updates an `last_seen_at`, separate Indexierung).

#### edges

```sql
CREATE TABLE edges (
  id           bigserial PRIMARY KEY,
  from_id      text NOT NULL,
  to_id        text NOT NULL,
  type         text NOT NULL,
  source       text NOT NULL,             -- Erzeuger inkl. Version
  confidence   real NOT NULL DEFAULT 1.0,
  weight       real NOT NULL DEFAULT 1.0,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,                -- NULL = aktuell gültig
  observed_at  timestamptz NOT NULL,
  evidence     jsonb,

  UNIQUE (from_id, to_id, type, source)
);

CREATE INDEX edges_from   ON edges(from_id, type) WHERE valid_to IS NULL;
CREATE INDEX edges_to     ON edges(to_id, type)   WHERE valid_to IS NULL;
CREATE INDEX edges_source ON edges(source);
```

Das UNIQUE auf `(from_id, to_id, type, source)` ist die Multi-Source-Disziplin: derselbe Erzeuger kann eine Edge nur einmal schreiben (Idempotenz), aber mehrere Erzeuger können dieselbe logische Edge nebeneinander schreiben.

Indizes haben `WHERE valid_to IS NULL` als Partial-Index — Standard-Queries (aktuell gültige Edges) sind damit billig, auch wenn die Tabelle historisch wächst.

#### topics

```sql
CREATE TABLE topics (
  id                      text PRIMARY KEY,
  status                  text NOT NULL,           -- proposed | active | archived | superseded
  label                   text,
  description             text,

  -- Discovery-Provenance (vom Materializer)
  discovered_at           timestamptz NOT NULL,
  discovered_by           text NOT NULL,

  -- Lifecycle (vom Materializer)
  archived_at             timestamptz,
  superseded_by           text REFERENCES topics(id),

  -- Aktivitäts-State (vom Topic-Activity-Worker, NICHT vom Materializer)
  member_count            integer NOT NULL DEFAULT 0,
  source_count            integer NOT NULL DEFAULT 0,
  unique_authors_7d       integer NOT NULL DEFAULT 0,
  first_activity_at       timestamptz,
  last_activity_at        timestamptz,
  velocity_24h            integer,
  velocity_7d_avg         real,
  spread_24h              integer,
  activity_trend          text,                    -- growing | stable | declining | dormant
  computed_at             timestamptz,

  -- Stagnation (vom Topic-Activity-Worker)
  stagnation_signal_count integer NOT NULL DEFAULT 0,
  stagnation_severity     text NOT NULL DEFAULT 'none',

  -- Centroid (vom Topic-Worker, siehe Zettel 5)
  centroid                vector(1024),

  payload                 jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX topics_status   ON topics(status) WHERE status = 'active';
CREATE INDEX topics_activity ON topics(last_activity_at DESC) WHERE status = 'active';
CREATE INDEX topics_centroid ON topics USING hnsw (centroid vector_cosine_ops)
  WHERE status = 'active' AND centroid IS NOT NULL;
```

Wichtige Trennung: der Materializer schreibt nur Status, Label, Discovery-Provenance, Lifecycle. Aktivitätsmetriken und Centroid werden von anderen Workern direkt geschrieben. Das `centroid`-Feld kommt vom Topic-Worker (siehe Zettel 5).

Der HNSW-Index auf `centroid` ist Partial — nur aktive Topics mit Centroid. Damit ist der Topic-Worker-Lookup schnell (siehe Zettel 5).

#### topic_assessments

```sql
CREATE TABLE topic_assessments (
  topic_id         text NOT NULL,
  assessor         text NOT NULL,                -- 'llm:claude:v1'
  assessed_at      timestamptz NOT NULL,

  character        text NOT NULL,                -- attention | opportunity | noteworthy | calm
  escalation_score real NOT NULL,
  reasoning        jsonb NOT NULL,
  triggered_by     text,

  PRIMARY KEY (topic_id, assessor, assessed_at)
);

CREATE INDEX topic_assessments_recent ON topic_assessments(topic_id, assessed_at DESC);
```

Append-only — alte Bewertungen werden nicht überschrieben, sondern als Historie behalten. Tools lesen die jüngste Bewertung pro `(topic_id, assessor)` via `DISTINCT ON`.

#### embeddings

```sql
CREATE TABLE embeddings (
  record_id     text NOT NULL,
  chunk_idx     integer NOT NULL DEFAULT 0,
  chunk_text    text NOT NULL,
  model_version text NOT NULL,
  vector        vector(1024) NOT NULL,           -- pgvector, dims abhängig von Modell
  generated_at  timestamptz NOT NULL,

  PRIMARY KEY (record_id, chunk_idx, model_version)
);

CREATE INDEX embeddings_vec_hnsw ON embeddings
  USING hnsw (vector vector_cosine_ops);
```

Schreibt der Embedding-Worker direkt, nicht der Materializer. Modell-Version ist Teil des Primary Keys — beim Modell-Wechsel können neue Embeddings parallel zu alten existieren.

#### events_archive

```sql
CREATE TABLE events_archive (
  event_id        text PRIMARY KEY,
  event_type      text NOT NULL,
  schema_version  integer NOT NULL,
  occurred_at     timestamptz NOT NULL,
  observed_at     timestamptz NOT NULL,
  source          text NOT NULL,
  source_event_id text,
  subject_kind    text NOT NULL,
  subject_id      text NOT NULL,
  payload         jsonb NOT NULL,
  evidence        jsonb,
  causation_id    text,
  correlation_id  text
);

CREATE INDEX events_archive_subject     ON events_archive(subject_kind, subject_id);
CREATE INDEX events_archive_correlation ON events_archive(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX events_archive_observed    ON events_archive(observed_at);
```

Wird vom _Postgres-Sink-Consumer_ geschrieben, nicht vom Materializer. Erwähnt hier nur der Vollständigkeit halber.

### Handler im Detail

#### handleRecordObserved

```typescript
async function handleRecordObserved(envelope: EventEnvelope) {
  const payload = RecordObservedPayload.parse(envelope.payload);

  // User-Knoten in eigene Tabelle
  if (payload.type === 'user') {
    await db.query(`
      INSERT INTO users (id, source, display_name, email, is_bot, is_external,
                         payload, first_seen_at, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            email        = EXCLUDED.email,
            payload      = EXCLUDED.payload,
            last_seen_at = GREATEST(users.last_seen_at, EXCLUDED.last_seen_at)
    `, [...]);
    return;
  }

  // Records (inkl. Container)
  await db.query(`
    INSERT INTO records (id, type, source, title, body, payload,
                         created_at, updated_at, ingested_at, is_deleted)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
    ON CONFLICT (id) DO UPDATE
      SET title      = EXCLUDED.title,
          body       = EXCLUDED.body,
          payload    = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      WHERE records.updated_at <= EXCLUDED.updated_at  -- LWW-Pattern
  `, [
    payload.id, payload.type, payload.source,
    payload.title, payload.body, payload.payload,
    payload.created_at, payload.updated_at, envelope.observed_at,
  ]);
}
```

Die WHERE-Klausel im UPSERT ist die LWW-Konfliktauflösung. Wenn ein Replay-Event mit altem `updated_at` ankommt, wird _nicht_ überschrieben.

`search_vector` wird automatisch von Postgres gepflegt (Generated Column).

#### handleEdgeObserved

```typescript
async function handleEdgeObserved(envelope: EventEnvelope) {
  const payload = EdgeObservedPayload.parse(envelope.payload);

  await db.query(
    `
    INSERT INTO edges (from_id, to_id, type, source, confidence, weight,
                       valid_from, valid_to, observed_at, evidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (from_id, to_id, type, source) DO UPDATE
      SET confidence  = EXCLUDED.confidence,
          weight      = EXCLUDED.weight,
          valid_to    = EXCLUDED.valid_to,
          evidence    = EXCLUDED.evidence,
          observed_at = EXCLUDED.observed_at
      WHERE edges.observed_at <= EXCLUDED.observed_at
  `,
    [
      payload.from_id,
      payload.to_id,
      payload.type,
      payload.source,
      payload.confidence,
      payload.weight,
      payload.valid_from,
      payload.valid_to,
      envelope.observed_at,
      envelope.evidence,
    ],
  );
}
```

Stub-Resolution: der Handler prüft _nicht_, ob `to_id` existiert. Wenn die Mention auf einen noch nicht ingestierten Record zeigt, wird die Edge trotzdem geschrieben — der Ziel-Record kommt später, die Edge wird dann automatisch traversierbar.

#### handleRecordDeleted

```typescript
async function handleRecordDeleted(envelope: EventEnvelope) {
  await db.transaction(async (tx) => {
    // Soft-Delete
    await tx.query(
      `
      UPDATE records SET is_deleted = true, updated_at = $2
      WHERE id = $1 AND updated_at <= $2
    `,
      [envelope.subject_id, envelope.occurred_at],
    );

    // Alle ausgehenden und eingehenden Edges invalidieren
    await tx.query(
      `
      UPDATE edges SET valid_to = $2
      WHERE (from_id = $1 OR to_id = $1) AND valid_to IS NULL
    `,
      [envelope.subject_id, envelope.occurred_at],
    );
  });
}
```

Eine der wenigen Stellen, an denen der Materializer eine Multi-Statement-Transaction macht — Soft-Delete und Edge-Invalidierung müssen atomar sein.

#### handleTopicCreated

```typescript
async function handleTopicCreated(envelope: EventEnvelope) {
  const payload = TopicCreatedPayload.parse(envelope.payload);

  await db.query(
    `
    INSERT INTO topics (id, status, discovered_at, discovered_by,
                        member_count, source_count, unique_authors_7d,
                        velocity_24h, velocity_7d_avg, spread_24h,
                        activity_trend, computed_at,
                        stagnation_signal_count, stagnation_severity,
                        payload)
    VALUES ($1, 'proposed', $2, $3, 0, 0, 0, NULL, NULL, NULL,
            'stable', NULL, 0, 'none', $4)
    ON CONFLICT (id) DO NOTHING
  `,
    [
      payload.id,
      envelope.occurred_at,
      payload.discovered_by,
      JSON.stringify(payload.initial_centroid_summary || {}),
    ],
  );
}
```

`ON CONFLICT DO NOTHING` — Topics werden nicht überschrieben. Status-Übergänge laufen über `topic.activated` etc.

#### handleAssessmentCreated

```typescript
async function handleAssessmentCreated(envelope: EventEnvelope) {
  const payload = AssessmentCreatedPayload.parse(envelope.payload);

  await db.query(`
    INSERT INTO topic_assessments
      (topic_id, assessor, assessed_at, character, escalation_score,
       reasoning, triggered_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (topic_id, assessor, assessed_at) DO NOTHING
  `, [...]);
}
```

Append-only — bei Konflikt nicht überschreiben.

### Replay

Im Pilot trivial: Read-Tabellen leeren, Materializer-Consumer löschen und mit `deliver_policy: 'all'` neu erstellen:

```typescript
async function fullReplay() {
  await db.query('TRUNCATE records, users, edges, topics, topic_assessments CASCADE');
  await db.query('TRUNCATE embeddings'); // Embedding-Worker rebuildet

  await jsm.consumers.delete('EVENTS', 'materializer');
  await jsm.consumers.add('EVENTS', {
    durable_name: 'materializer',
    filter_subject: 'events.>',
    deliver_policy: 'all',
    ack_policy: 'explicit',
  });
}
```

Postgres-Sink-Consumer kann parallel weiterlaufen (er hat seinen eigenen Cursor).

## Warum

**Warum ein Worker für alles, kein spezialisierter pro Tabelle?** Pilot-Komplexität minimieren. Spezialisierte Worker wären in Produktion bei hohen Volumina sinnvoll (parallele Skalierung pro Tabelle), aber im Pilot überwiegt die Vereinfachung. Subject-Routing per Switch ist klar und wartbar. Wenn der Durchsatz später Probleme macht, ist die Aufteilung additiv möglich — pro Tabelle ein eigener Consumer mit Subject-Filter.

**Warum eventually consistent?** Synchrone Materialisierung würde Tx-Kopplung mit dem Stream erfordern. JetStream und Postgres haben keine gemeinsame Transaction. Mit Postgres-als-Stream wäre Tx-Kopplung möglich, aber dann verlieren wir die operativen Vorteile von JetStream (Durable Consumers, Subject-Routing, Replay). Eventually Consistency ist die ehrliche Wahl, im Tool-Vertrag dokumentiert.

**Warum LWW-Pattern statt naivem UPSERT?** Out-of-Order-Events sind realistisch — Backfill kann mit Live-Stream konkurrieren, JetStream redelivered nach NAK. Ohne LWW würde ein verspätetes älteres Event die aktuelleren Daten überschreiben. Mit LWW wird die Materialisierung kommutativ — End-State hängt nur von der Event-Menge ab, nicht der Reihenfolge.

**Warum pgvector statt eigener Vektor-Datenbank?** Wir haben Postgres ohnehin als Read-Model. pgvector ist reif, gut integriert (`vector_cosine_ops`, HNSW-Indizes), und vermeidet eine zweite Datenbank-Komponente. Trade-off: pgvector ist nicht so performant wie spezialisierte Vector-DBs (Qdrant, Weaviate), aber im Pilot weit ausreichend.

**Warum Generated Column für `search_vector`?** Postgres pflegt sie automatisch, kein separater FTS-Code im Materializer. Bei UPSERT wird sie automatisch neu berechnet. Trade-off: Generated Columns sind nicht updatable, aber das brauchen wir auch nicht — `search_vector` ist deterministisch aus `title` und `body` ableitbar.

**Warum partial Indizes mit `WHERE valid_to IS NULL`?** Edges-Tabelle wächst historisch (alte Edges werden nie gelöscht, nur invalidiert). Standard-Queries fragen nach aktuellen Edges — der partial Index hält nur diese. Bei vielen invalidierten Edges spart das Index-Größe und Query-Zeit deutlich.

**Warum User-Knoten in eigener Tabelle?** Anders genug von normalen Records (häufige Updates an `last_seen_at`, separate Indexierung auf `email` für Identity-Resolution-Vorbereitung), um eine eigene Tabelle zu rechtfertigen. Schema-mäßig liegen sie aber im selben Knoten-Konzept — einfach zu refaktorieren falls nötig.

**Warum Aktivitätsmetriken NICHT vom Materializer?** Sie sind Aggregate über `discusses`-Edges, nicht aus einem einzelnen Event ableitbar. Der Topic-Activity-Worker rechnet sie pro betroffenem Topic, getriggert von `discusses`-Edge-Events. Wenn der Materializer das mitmachen würde, wären seine Handler nicht mehr "ein Event, eine Operation" — Komplexitäts-Sprung.

## Beispiele

### Beispiel: State nach den vier Beispiel-Events aus Zettel 2

Tabellen-Inhalt nach dem Slack-Reply, der GitHub-Issue, der Jira-Issue und dem Confluence-Comment:

**records:**

```
id                                              | type    | source     | title                                              | body (gekürzt)         | created_at              | updated_at              | is_deleted
────────────────────────────────────────────────┼─────────┼────────────┼────────────────────────────────────────────────────┼────────────────────────┼─────────────────────────┼─────────────────────────┼───────────
slack:msg:T01ABC/C02DEF/1714028591.012345       | message | slack      | NULL                                               | Stimmt — und der ...   | 2026-04-15 09:23:11+00  | 2026-04-15 09:23:11+00  | false
github:issue:onboardflow/api/42                 | issue   | github     | Vertragsimport bricht bei dritter Datei ab         | Beim Hochladen ...     | 2026-04-14 11:02:00+00  | 2026-04-14 11:02:00+00  | false
jira:issue:10042                                | issue   | jira       | BiPro Norm 430.4 – Concordia-Anbindung nachziehen  | Concordia liefert ...  | 2025-11-12 08:30:00+00  | 2026-03-15 14:22:00+00  | false
confluence:comment:9123456                      | comment | confluence | NULL                                               | Achtung: die Anleit... | 2026-04-12 14:33:00+00  | 2026-04-12 14:33:00+00  | false
```

**edges (Auswahl):**

```
id   | from_id                                    | to_id                                  | type             | source     | conf | valid_from              | valid_to
─────┼────────────────────────────────────────────┼────────────────────────────────────────┼──────────────────┼────────────┼──────┼─────────────────────────┼──────────
1    | slack:msg:T01ABC/C02DEF/1714028591.012345  | slack:user:T01ABC/U01ALICE             | authored_by      | slack:v1   | 1.00 | 2026-04-15 09:23:11+00  | NULL
2    | slack:msg:T01ABC/C02DEF/1714028591.012345  | slack:channel:T01ABC/C02DEF            | posted_in        | slack:v1   | 1.00 | 2026-04-15 09:23:11+00  | NULL
3    | slack:msg:T01ABC/C02DEF/1714028591.012345  | slack:msg:T01ABC/C02DEF/1714028000.001 | replies_to       | slack:v1   | 1.00 | 2026-04-15 09:23:11+00  | NULL
8    | jira:issue:10042                           | jira:user:712020:abc-123               | authored_by      | jira:v1    | 1.00 | 2025-11-12 08:30:00+00  | NULL
10   | jira:issue:10042                           | jira:sprint:12                         | belongs_to_sprint| jira:v1    | 1.00 | 2025-11-12 08:30:00+00  | 2026-04-15 10:00:00+00
11   | jira:issue:10042                           | jira:sprint:13                         | belongs_to_sprint| jira:v1    | 1.00 | 2026-04-15 10:00:00+00  | NULL
```

Edge 10 zeigt das Sprint-Wechsel-Pattern — alte Edge mit `valid_to`, neue Edge offen. Beide bleiben in der Tabelle für Audit.

### Beispiel: Hybrid-Search-Query gegen records

```sql
SELECT id, title, body,
       ts_rank(search_vector, query) AS lex_score
FROM records, websearch_to_tsquery('german', 'BiPro Bestandsübertragung') AS query
WHERE search_vector @@ query
  AND is_deleted = false
ORDER BY lex_score DESC
LIMIT 10;
```

GIN-Index auf `search_vector` macht das schnell, auch bei mehreren tausend Records. `websearch_to_tsquery` versteht Quotes, AND, OR.

### Beispiel: Edge-Traversierung für `get_neighbors`

```sql
SELECT e.from_id, e.to_id, e.type, e.confidence, e.source, e.evidence
FROM edges e
WHERE e.from_id = $1
  AND e.type = ANY($2::text[])
  AND e.valid_to IS NULL
ORDER BY e.confidence DESC, e.observed_at DESC
LIMIT 50;
```

Partial-Index auf `(from_id, type) WHERE valid_to IS NULL` macht das billig.

## Cross-Links

- Was im Stream ankommt: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Wer die Edge-Events erzeugt: [Zettel 2 — Connectors](./02_connectors.md), [Zettel 7 — Mention-Extractor](./07_mention_extractor.md)
- Wer Embeddings schreibt: [Zettel 4 — Embedding](./04_embedding.md)
- Wer Topics und `discusses`-Edges schreibt: [Zettel 5 — Clustering](./05_clustering.md)
- Wer auf den Tabellen liest: [Zettel 6 — Tool-Layer](./06_tool_layer.md)
