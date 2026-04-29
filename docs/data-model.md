# Data Model

Stand: 2026-04-29. Quelle der Wahrheit ist `packages/db/src/schema.ts`. Migrationen unter `packages/db/migrations/`. Dieses Dokument ist eine kommentierte Karte – bei Diskrepanz gewinnt das Schema.

## Bird's-Eye View

```
                ┌────────────────────────────┐
                │           topics           │
                │  (discovered cluster)      │
                └────────────┬───────────────┘
                             ▲ to_id
                             │ edges.type='discusses'
                             │ valid_to IS NULL
                             │
        ┌────────────────────┴───────────────────┐
        │                  edges                 │  ← bitemporal,
        │  (typed, weighted, time-versioned)     │    multi-source
        └────────────────────┬───────────────────┘
                             │ from_id
                             ▼
   ┌────────────────────────────────────────────────┐
   │                   records                      │
   │  chat_message · post · comment · issue · user  │
   │  payload (jsonb) · search_vector (tsvector)    │
   └─────────────────────────┬──────────────────────┘
                             │ record_id
                             ▼
                ┌────────────────────────────┐
                │         embeddings         │
                │  pgvector (1536 dim, hnsw) │
                └────────────────────────────┘

   topic_assessments  ── append-only, (topic_id, assessor, assessed_at) PK
   events_archive     ── audit log (all observed events, lossless)
```

## Kerntabellen

### `records` — die kanonische Wahrheit

Alles, was ingestiert wird, wird ein Record: Slack-Messages, GitHub-Issues, Jira-Tickets, User, Channels, Boards. Records sind upsertbar (`id` ist source-stable), nichts wird gelöscht, sondern `is_deleted` gesetzt.

| Spalte                      | Typ           | Anmerkung                                                                                                   |
| --------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                        | `text` PK     | source-stable, z. B. `slack:T0/C1/12345.6789`                                                               |
| `type`                      | `text`        | Subjektart: `chat_message`, `post`, `comment`, `issue`, `conversation`, `channel`, `user`, `contact`, …     |
| `source`                    | `text`        | Konnektor-ID (`slack`, `github`, `jira`, `intercom`, …)                                                     |
| `title` / `body`            | `text?`       | optional; full-text-indexiert                                                                               |
| `payload`                   | `jsonb`       | source-spezifischer Roh-Kontext (GIN-indexiert)                                                             |
| `created_at` / `updated_at` | `timestamptz` | aus der Quelle                                                                                              |
| `ingested_at`               | `timestamptz` | wann wir es gesehen haben                                                                                   |
| `is_deleted`                | `bool`        | soft delete                                                                                                 |
| `search_vector`             | `tsvector`    | **generiert**: `setweight(to_tsvector('german', title), 'A') ‖ setweight(to_tsvector('german', body), 'B')` |

Indizes:

- `records_source_type` (`source`, `type`)
- `records_updated` (`updated_at DESC`)
- `records_search` (GIN auf `search_vector`)
- `records_payload_gin` (GIN auf `payload`)

> **Hinweis für Read-Pfade:** `RecordRow` in `packages/db/src/read/types.ts` schließt `searchVector` per `Omit<>` aus — das Feld ist Index-Treibstoff, nicht Teil des Read-Models.

### `edges` — getypte Kanten zwischen Records (und Topics)

Bitemporales, multi-source Graph-Modell. Jede Kante hat einen Typ, eine Konfidenz und ein Gültigkeitsintervall. „Aktuelle" Kante = `valid_to IS NULL`.

| Spalte                   | Typ            | Anmerkung                                                                                  |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------ |
| `id`                     | `bigserial` PK |                                                                                            |
| `from_id`, `to_id`       | `text`         | typischerweise Record- oder Topic-IDs (FKs sind nicht erzwungen — multi-tenant Edge-Types) |
| `type`                   | `text`         | siehe Edge-Typen unten                                                                     |
| `source`                 | `text`         | wer die Kante behauptet (`slack`, `mention-extractor`, `topic-discovery`, …)               |
| `confidence`             | `real`         | 0..1, default `1.0`                                                                        |
| `weight`                 | `real`         | freier Gewichtungsslot, default `1.0`                                                      |
| `valid_from`, `valid_to` | `timestamptz`  | bitemporal; `valid_to IS NULL` = aktiv                                                     |
| `observed_at`            | `timestamptz`  | wann beobachtet                                                                            |
| `evidence`               | `jsonb?`       | begründungsspezifischer Kontext                                                            |

Constraints/Indizes:

- `edges_uniq` UNIQUE (`from_id`, `to_id`, `type`, `source`) — derselbe Source darf eine Kante nicht doppelt behaupten.
- `edges_from` / `edges_to` — partial auf `valid_to IS NULL`, getypte Reverse-Lookups.
- `edges_source` — Filter nach Erzeuger.

**Edge-Typen, die heute geschrieben werden** (aus den Domain-Paketen ermittelt):

| Type          | Richtung                 | Erzeuger                           | Bedeutung                                                  |
| ------------- | ------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| `discusses`   | record → topic           | `topic-discovery` / `materializer` | Record gehört zu Topic-Cluster. Tragende Kante für die UI. |
| `mentions`    | record → entity (record) | `mention-extractor`                | Record erwähnt User/Channel/Issue.                         |
| `authored_by` | record → user            | connectors / materializer          | Autorenschaft.                                             |
| `posted_in`   | record → channel/board   | connectors                         | Kontext-Container.                                         |
| `replies_to`  | record → record          | connectors                         | Thread-Struktur.                                           |

> Liste ist deskriptiv, nicht durchgesetzt. Neue Typen sind erlaubt; sie tauchen automatisch in den Filtern auf.

### `topics` — entdeckte Cluster

| Spalte                                                                                              | Typ                                   | Anmerkung                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                                                                                | `text` PK                             |                                                                                        |
| `status`                                                                                            | `text`                                | `active` / `archived` / `superseded` (de-facto Enum, kein Check-Constraint)            |
| `label`, `description`                                                                              | `text?`                               | menschenlesbar                                                                         |
| `discovered_at`, `discovered_by`                                                                    | `timestamptz` / `text`                | Provenienz                                                                             |
| `archived_at`, `superseded_by`                                                                      | `timestamptz?` / `text? FK→topics.id` | Lifecycle                                                                              |
| `member_count`, `source_count`, `unique_authors_7d`                                                 | `int`                                 | aggregierte Statistiken                                                                |
| `first_activity_at`, `last_activity_at`                                                             | `timestamptz?`                        | aus Member-Records gerollt                                                             |
| `velocity_24h` (`int`), `velocity_7d_avg` (`real`), `spread_24h` (`int`), `activity_trend` (`text`) |                                       | Aktivitätssignale                                                                      |
| `computed_at`                                                                                       | `timestamptz?`                        | wann die Stats neu berechnet wurden                                                    |
| `stagnation_signal_count` (`int`), `stagnation_severity` (`text`, default `'none'`)                 |                                       | Stagnations-Heuristik                                                                  |
| `centroid`                                                                                          | `vector(1536)`                        | Topic-Embedding, mit `with-neighbors`-Strategie aus den Members inkrementell gemittelt |
| `payload`                                                                                           | `jsonb`                               | freier Erweiterungsslot                                                                |

Indizes:

- `topics_status` partial auf `status='active'`
- `topics_activity` partial auf `last_activity_at DESC` (nur active)
- `topics_centroid` HNSW (cosine), partial auf `status='active' AND centroid IS NOT NULL`

Self-FK: `superseded_by → topics.id` für Topic-Merges.

### `topic_assessments` — Bewertungen über die Zeit

Append-only Log von LLM- oder Heuristik-Urteilen pro Topic.

| Spalte                                | Typ          | Anmerkung                                               |
| ------------------------------------- | ------------ | ------------------------------------------------------- |
| `topic_id`, `assessor`, `assessed_at` | composite PK | mehrere Assessoren pro Topic, beliebig oft re-assessbar |
| `character`                           | `text`       | klassifiziertes Topic-Charakter-Label                   |
| `escalation_score`                    | `real`       | numerisches Eskalationssignal                           |
| `reasoning`                           | `jsonb`      | strukturiert; Kettenkontext, Zitate, Modellname         |
| `triggered_by`                        | `text?`      | Event/Edge, das die Re-Assessment ausgelöst hat         |

Index `topic_assessments_recent` (`topic_id`, `assessed_at DESC`) — die `getTopics`-Query rankt darüber per Window-Funktion (`ROW_NUMBER`), siehe `packages/db/src/read/topics.ts`.

### `embeddings` — Vektorrepräsentationen

| Spalte                                    | Typ            | Anmerkung                                           |
| ----------------------------------------- | -------------- | --------------------------------------------------- |
| `record_id`, `chunk_idx`, `model_version` | composite PK   | mehrere Chunks pro Record, mehrere Modelle parallel |
| `chunk_text`                              | `text`         | das, was tatsächlich embeddet wurde                 |
| `vector`                                  | `vector(1536)` | pgvector                                            |
| `generated_at`                            | `timestamptz`  |                                                     |

Index: `embeddings_vec_hnsw` (HNSW, cosine).

> **Modell-Migration:** Embeddings werden nicht in-place rotiert — neue `model_version` parallel schreiben, dann lesend umschalten, dann alte Version löschen.

### `events_archive` — verlustfreier Audit-Log

Alles, was beobachtet wurde — Connector-Events, Materializer-Decisions, Topic-Merges. Kein Lifecycle, kein Update.

| Spalte                           | Typ            | Anmerkung                                            |
| -------------------------------- | -------------- | ---------------------------------------------------- |
| `event_id`                       | `text` PK      |                                                      |
| `event_type`, `schema_version`   | `text` / `int` | Event-Format                                         |
| `occurred_at`                    | `timestamptz`  | wann real passiert                                   |
| `observed_at`                    | `timestamptz`  | wann wir's gesehen haben                             |
| `source`, `source_event_id`      |                | Provenienz                                           |
| `subject_kind`, `subject_id`     |                | wozu das Event gehört (`record`, `topic`, `edge`, …) |
| `payload`                        | `jsonb`        | volle Event-Body                                     |
| `evidence`                       | `jsonb?`       | optional                                             |
| `causation_id`, `correlation_id` | `text?`        | Event-Tracing                                        |

Indizes: `events_archive_subject` (`subject_kind`, `subject_id`), `events_archive_correlation` (partial), `events_archive_observed`.

## Querschnitts-Konventionen

- **IDs sind `text`** — niemals UUIDs aus Sequenzen erfinden. Source-stable Strings (`<source>:<native_id>`) sind Pflicht für idempotente Upserts.
- **Soft-Delete only.** `is_deleted=true` auf Records, `valid_to=now()` auf Edges. Topics werden archiviert oder superseded, nie hart gelöscht.
- **Bitemporal heißt: zwei Zeitachsen.** `occurred_at`/`valid_from` = Realität. `observed_at`/`ingested_at` = unsere Sicht. Reports laufen üblicherweise auf der Realitätsachse, Backfills auf der Beobachtungsachse.
- **JSONB-Payloads sind frei**, aber GIN-indexiert auf `records.payload`. Schreiboperationen sollten Felder, die später gefiltert werden, konsistent benennen.
- **pgvector** kommt mit zwei HNSW-Indizes auf `topics` (Standard- + body-only-Centroid) und einem auf `embeddings`. Cosine ist der Default-Operator (`vector_cosine_ops`).

## Typische Joins (Spickzettel)

**Records eines Topics (aktive Mitgliedschaft):**

```sql
SELECT r.*
FROM records r
JOIN edges  e ON e.from_id = r.id AND e.type = 'discusses' AND e.valid_to IS NULL
WHERE e.to_id = $1 AND r.is_deleted = FALSE
ORDER BY e.confidence DESC;
```

**N letzte Assessments pro Topic** (aus `read/topics.ts` extrahiert):

```sql
SELECT *
FROM (
  SELECT a.*, ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY assessed_at DESC) AS rn
  FROM topic_assessments a
  WHERE a.topic_id = ANY($1::text[])
) ranked
WHERE rn <= $2;
```

**Vektor-Nachbarn eines Records** (cosine, HNSW):

```sql
SELECT e.record_id, 1 - (e.vector <=> $1::vector) AS similarity
FROM embeddings e
WHERE e.model_version = $2
ORDER BY e.vector <=> $1::vector
LIMIT 20;
```

## Lifecycle in einem Satz

> Connector schreibt einen **record** und ein paar **edges** (`authored_by`, `posted_in`, ggf. `replies_to`). Das **embedder**-Paket füllt **embeddings**. Der **mention-extractor** ergänzt `mentions`-Edges. Die **topic-discovery** clustert über die Vektoren und schreibt `discusses`-Edges + neue/aktualisierte **topics**. LLM-Reviewer hängt periodisch **topic_assessments** an. Alles, was passiert, landet zusätzlich in **events_archive**.

## Hands-on

```bash
docker-compose up -d        # Postgres + pgvector lokal
pnpm db:push                # Schema synchronisieren (Dev)
pnpm db:generate            # neue Drizzle-Migration aus Schema-Diff
pnpm db:migrate             # Migrationen anwenden
pnpm db:studio              # Drizzle Studio
```

Bei Schema-Drift an `records`/`edges` ist `packages/materializer/test/setup.ts` mitzuziehen (manuelles DDL-Spiegelbild) — siehe Root-`AGENTS.md`.
