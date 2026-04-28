# Zettel 1 — Eventsystem und Event-Schema

Übersicht über das Backbone des Systems. Was im Stream landet, wie Subjects strukturiert sind, wie Schemas verbindlich gemacht werden, wie Idempotenz funktioniert.

---

## Was

Das gesamte System ist event-getrieben. Jede Beobachtung, jede Inferenz, jede Aggregation passiert als Event und landet in einem zentralen Stream. Aus diesem Stream konsumieren mehrere Worker parallel und unabhängig.

**Stack.**

- NATS JetStream als Stream-Backbone (Server `nats:2.12-alpine`)
- TypeScript-Clients `@nats-io/transport-node` und `@nats-io/jetstream` in v3.3.x
- Zod-Schemas als verbindliche Definition der Event-Payloads
- Postgres-Sink-Consumer als zweite Schicht für Audit und Long-Window-Idempotenz

**Was der Stream enthält.** Sechs Familien von Events:

- `record.observed`, `record.updated`, `record.deleted`, `record.tombstoned` (Lebenszyklus von Quell-Artefakten)
- `edge.observed` (alle Beziehungen — strukturell vom Connector, inferiert vom Mention-Extractor, aggregiert vom Topic-Worker)
- `embedding.created` (neue Vektoren)
- `topic.created`, `topic.activated`, `topic.archived`, `topic.superseded` (Topic-Lifecycle)
- `topic.assessment.created` (LLM-Bewerter-Outputs)
- `system.replay.started`, `system.replay.completed` (Operations)

## Wie

### Subject-Schema

Jedes Event hat ein NATS-Subject nach dem Schema `events.<event-type>.<source>`:

```
events.record.observed.slack
events.record.observed.github
events.record.observed.jira
events.record.observed.confluence
events.record.updated.slack
events.record.deleted.slack

events.edge.observed.slack            (strukturell, vom Connector)
events.edge.observed.github
events.edge.observed.jira
events.edge.observed.confluence
events.edge.observed.mention-extractor-regex
events.edge.observed.mention-extractor-llm
events.edge.observed.topic-discovery   (discusses-Edges)

events.embedding.created
events.topic.created
events.topic.activated
events.topic.archived
events.topic.superseded
events.topic.assessment.created

events.system.replay.started
events.system.replay.completed
```

Subjects sind nicht nur Routing-Adressen, sondern auch Filter. Worker abonnieren sich nur auf das, was sie betrifft — der Materializer auf `events.>` (alles), der Embedding-Worker auf `events.record.>`, der Topic-Worker auf `events.embedding.created`.

### Stream-Konfiguration

Ein einziger Stream namens `EVENTS`:

- Subjects: `events.>`
- Storage: File (persistent über Restarts)
- Retention: keine Auto-Löschung, unbegrenzte Aufbewahrung im Pilot
- Duplicate Window: 2 Minuten (für serverseitige `Nats-Msg-Id`-Dedup)
- Discard Policy: `old` (sollte im Pilot nie greifen)

### Worker als Durable Consumers

Jeder Worker registriert einen Durable Consumer auf dem Stream mit einem Subject-Filter und einem Namen:

| Worker                    | Durable Name      | Subject-Filter                         |
| ------------------------- | ----------------- | -------------------------------------- |
| Materializer              | `materializer`    | `events.>`                             |
| Postgres-Sink             | `events-sink`     | `events.>`                             |
| Embedding-Worker          | `embedder`        | `events.record.>`                      |
| Mention-Extractor (Regex) | `mention-regex`   | `events.record.>`                      |
| Mention-Extractor (LLM)   | `mention-llm`     | `events.record.>`                      |
| Topic-Worker              | `topic-discovery` | `events.embedding.created`             |
| Topic-Activity-Worker     | `topic-activity`  | `events.edge.observed.topic-discovery` |
| LLM-Bewerter              | `llm-assessor`    | `events.topic.>` und Cron-getriggert   |

Cursor-Tracking, Retry-Logik und At-least-once-Delivery sind eingebaut — keine eigene `worker_state`-Tabelle nötig.

### Generic Event Envelope

Jedes Event hat dieselbe Hülle. Definiert in Zod:

```typescript
import { z } from 'zod';

export const EventEnvelope = z.object({
  event_id: z.string(), // deterministischer Hash
  event_type: z.string(), // 'record.observed', 'edge.observed', ...
  schema_version: z.number().int().min(1),
  occurred_at: z.string().datetime(), // Quell-Zeit
  observed_at: z.string().datetime(), // System-Zeit
  source: z.string(), // 'slack', 'mention-extractor:regex:v1', ...
  source_event_id: z.string().nullable(), // Source-API-Referenz, optional
  subject_kind: z.enum(['record', 'edge', 'topic', 'embedding', 'assessment', 'system']),
  subject_id: z.string(),
  payload: z.unknown(), // event-typ-spezifisch, in eigenen Schemas validiert
  evidence: z.unknown().nullable(), // optional, bei inferierten Events
  causation_id: z.string().nullable(), // welches Event hat dieses ausgelöst
  correlation_id: z.string().nullable(), // logische Gruppierung (z.B. Topic-ID)
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;
```

### Event-Type-spezifische Payloads

Jeder Event-Typ hat ein eigenes Zod-Schema für den `payload`. Beim Publishen und Konsumieren wird zuerst der Envelope validiert, dann der Payload nach `event_type` in den passenden Schema gesteckt:

```typescript
export const RecordObservedPayload = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  payload: z.record(z.unknown()), // inner payload, quellen-spezifisch
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const EdgeObservedPayload = z.object({
  from_id: z.string(),
  to_id: z.string(),
  type: z.enum([
    'authored_by',
    'replies_to',
    'commented_on',
    'posted_in',
    'child_of',
    'references',
    'assigned_to',
    'belongs_to_sprint',
    'mentions',
    'discusses',
    'supersedes',
  ]),
  source: z.string(), // Erzeuger inkl. Version, z.B. 'slack:v1' oder 'mention-extractor:regex:v1'
  confidence: z.number().min(0).max(1),
  weight: z.number().min(0).default(1.0),
  valid_from: z.string().datetime(),
  valid_to: z.string().datetime().nullable(),
});

export const TopicCreatedPayload = z.object({
  id: z.string(), // 'topic:<uuid>'
  status: z.literal('proposed'),
  discovered_by: z.string(),
  initial_centroid_summary: z.object({
    sample_record_ids: z.array(z.string()),
    cluster_size: z.number().int(),
    intra_cluster_distance_avg: z.number(),
  }),
});

// ... pro event_type ein eigenes Schema
```

Empfehlung: ein gemeinsames Package `@pilot/events` mit allen Schemas, das von allen Workern importiert wird. Damit ist jede Schema-Änderung in einer Stelle vorgenommen und alle Worker bekommen sie via npm-Update.

### Idempotenz auf zwei Ebenen

**Erste Ebene — `Nats-Msg-Id`.** Beim Publishen setzt der Producer den Header `Nats-Msg-Id` auf den deterministischen Hash. JetStream verwirft serverseitig Duplikate innerhalb von 2 Minuten. Damit sind Webhook-Retries und Worker-Restarts während Burst-Last abgefedert.

**Zweite Ebene — `event_id` in Postgres.** Der Postgres-Sink-Consumer schreibt jedes Event in die `events_archive`-Tabelle. Der Primary Key auf `event_id` macht die Einfügung idempotent über beliebige Zeiträume. Damit sind Replays und langlaufende Backfills abgesichert.

Der deterministische Hash für `event_id` und `Nats-Msg-Id` wird identisch berechnet:

```typescript
function deterministicEventId(
  event_type: string,
  source: string,
  subject_id: string,
  occurred_at: string,
  content_hash: string,
): string {
  const input = `${event_type}|${source}|${subject_id}|${occurred_at}|${content_hash}`;
  return `evt_${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}
```

`content_hash` ist ein SHA-256 über die normalisierten Payload-Felder. Bei Records typischerweise über `(title, body, updated_at)`. Bei Edges über `(from_id, to_id, type, source, valid_from)`.

### Replay

Replay funktioniert subject-granular: Consumer löschen, mit `deliver_policy: 'all'` neu erstellen, der Worker liest alle Events nochmal:

```typescript
// Worker komplett zurücksetzen
await jsm.consumers.delete('EVENTS', 'topic-discovery');
await jsm.consumers.add('EVENTS', {
  durable_name: 'topic-discovery',
  filter_subject: 'events.embedding.created',
  deliver_policy: 'all',
  ack_policy: 'explicit',
});
```

Idempotenz auf Postgres-Seite (UNIQUE-Constraints, UPSERT-Pattern) sorgt dafür, dass der Replay denselben State produziert wie der Original-Lauf.

### Bi-temporale Felder

`occurred_at` ist die Quell-Zeit (wann ist das in der Source passiert). `observed_at` ist die System-Zeit (wann hat der Connector es gesehen). Diese Trennung ist für Out-of-Order-Toleranz zentral — der Materializer nutzt `occurred_at` für LWW-Konfliktauflösung, `observed_at` ist primär für Audit und Lag-Metriken.

Bei inferierten Events (Mention-Extractor, Topic-Worker) ist `occurred_at` typischerweise die Beobachtungs-Zeit der Inferenz, weil es keine direkte Source-Zeit gibt.

## Warum

**Warum NATS JetStream und nicht Postgres-als-Stream?** JetStream übernimmt Subject-Routing, Durable Consumer, At-least-once-Delivery, Replay als native Features. Mit Postgres-als-Stream müssten wir alles selbst bauen — Cursor-Tabellen, Polling-Loops, Subject-Index-Strategien. Trade-off: JetStream ist kein Query-Backend; Audit-Queries laufen über den Postgres-Sink.

**Warum Subject-Hierarchie?** Worker brauchen unterschiedliche Filter-Granularität. Der Materializer will alles sehen (`events.>`), der Topic-Worker nur Embeddings (`events.embedding.created`), der Mention-Extractor nur Records (`events.record.>`). NATS-Wildcards machen diese Filter deklarativ.

**Warum deterministische Event-IDs?** Idempotenz ist Voraussetzung für Replay und Robustheit gegen Webhook-Retries. Ohne deterministische IDs müsste das System verteilte Locks oder Inhalts-Vergleiche machen — beides fehleranfällig. Mit deterministischen IDs wird Idempotenz zu einer einfachen UNIQUE-Constraint.

**Warum Zod als Schema-Definition?** Wir nutzen nur TypeScript, also ist Zod die natürliche Wahl: Type-Inference, Runtime-Validation, gute Fehlermeldungen, kein Codegen-Schritt. Schemas können bei Bedarf zu JSON Schema exportiert werden, falls später externe Tools sie konsumieren sollen.

**Warum zwei Idempotenz-Ebenen?** JetStream's Duplicate-Window ist auf 2 Minuten begrenzt — sinnvoll für Webhook-Retries, zu kurz für Replay nach Stunden oder Tagen. Postgres-`events_archive` mit PK auf `event_id` macht Idempotenz unbegrenzt. Beide zusammen decken Burst-Last und Long-Window-Replay ab.

**Warum bi-temporale Felder?** Out-of-Order-Events sind realistisch — Webhook-Reihenfolge ist nicht garantiert, Replay kann mit Live-Stream konkurrieren. Ohne `occurred_at` gibt es keinen sinnvollen Konfliktlöser. Ohne `observed_at` keine Lag-Diagnose.

## Beispiele

### Beispiel 1: Slack-Reply als Record

Subject: `events.record.observed.slack`

```json
{
  "event_id": "evt_a3f9c8d2e7b1",
  "event_type": "record.observed",
  "schema_version": 1,
  "occurred_at": "2026-04-15T09:23:11.000Z",
  "observed_at": "2026-04-15T09:23:14.812Z",
  "source": "slack",
  "source_event_id": "T01ABC.C02DEF.1714028591.012345",
  "subject_kind": "record",
  "subject_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
  "payload": {
    "id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "type": "message",
    "source": "slack",
    "title": null,
    "body": "Stimmt — und der gleiche Einwand kam letzte Woche schon...",
    "payload": {
      "workspace_id": "T01ABC",
      "channel_id": "C02DEF",
      "ts": "1714028591.012345",
      "thread_ts": "1714028000.001234",
      "author_id": "U01ALICE"
    },
    "created_at": "2026-04-15T09:23:11.000Z",
    "updated_at": "2026-04-15T09:23:11.000Z"
  },
  "evidence": null,
  "causation_id": null,
  "correlation_id": null
}
```

### Beispiel 2: Strukturelle Edge vom Connector

Subject: `events.edge.observed.slack`

```json
{
  "event_id": "evt_b8d2a4f6c9e3",
  "event_type": "edge.observed",
  "schema_version": 1,
  "occurred_at": "2026-04-15T09:23:11.000Z",
  "observed_at": "2026-04-15T09:23:14.812Z",
  "source": "slack",
  "source_event_id": "T01ABC.C02DEF.1714028591.012345",
  "subject_kind": "edge",
  "subject_id": "edge:authored_by:slack:msg:T01ABC/C02DEF/1714028591.012345->slack:user:T01ABC/U01ALICE",
  "payload": {
    "from_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "to_id": "slack:user:T01ABC/U01ALICE",
    "type": "authored_by",
    "source": "slack:v1",
    "confidence": 1.0,
    "weight": 1.0,
    "valid_from": "2026-04-15T09:23:11.000Z",
    "valid_to": null
  },
  "evidence": null,
  "causation_id": "evt_a3f9c8d2e7b1",
  "correlation_id": null
}
```

### Beispiel 3: Inferierte Mention-Edge mit Evidence

Subject: `events.edge.observed.mention-extractor-regex`

```json
{
  "event_id": "evt_c9e3b8d4f1a7",
  "event_type": "edge.observed",
  "schema_version": 1,
  "occurred_at": "2026-04-15T09:23:14.812Z",
  "observed_at": "2026-04-15T09:23:15.124Z",
  "source": "mention-extractor:regex:v1",
  "source_event_id": null,
  "subject_kind": "edge",
  "subject_id": "edge:mentions:slack:msg:T01ABC/C02DEF/1714028591.012345->jira:issue:10042",
  "payload": {
    "from_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "to_id": "jira:issue:10042",
    "type": "mentions",
    "source": "mention-extractor:regex:v1",
    "confidence": 0.95,
    "weight": 1.0,
    "valid_from": "2026-04-15T09:23:11.000Z",
    "valid_to": null
  },
  "evidence": {
    "matched_text": "DEMV-4127",
    "match_offset_start": 142,
    "match_offset_end": 150,
    "extractor_version": "regex:v1",
    "pattern_id": "jira_key"
  },
  "causation_id": "evt_a3f9c8d2e7b1",
  "correlation_id": null
}
```

### Beispiel 4: Publisher-Code (Connector-Seite)

```typescript
import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import { RecordObservedEvent } from '@pilot/events';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = jetstream(nc);

const event: RecordObservedEvent = RecordObservedEvent.parse({
  event_id: deterministicEventId(...),
  event_type: 'record.observed',
  // ... weitere Felder
});

await js.publish(
  `events.record.observed.${event.source}`,
  JSON.stringify(event),
  { msgID: event.event_id }       // serverseitige Idempotenz
);
```

### Beispiel 5: Consumer-Code (Worker-Seite)

```typescript
import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import { EventEnvelope, RecordObservedPayload } from '@pilot/events';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = jetstream(nc);
const consumer = await js.consumers.get('EVENTS', 'embedder');

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type === 'record.observed') {
      const payload = RecordObservedPayload.parse(envelope.payload);
      await processRecord(payload);
      msg.ack();
    } else {
      msg.ack(); // Event-Typ ist nicht relevant für diesen Worker
    }
  } catch (err) {
    console.error('Error processing message:', err);
    msg.nak(); // Redelivery mit Backoff
  }
}
```
