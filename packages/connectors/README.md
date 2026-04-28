# @repo/connectors

Source-spezifische Mapper, die Mock-Snapshots auf Events für `@repo/messaging` abbilden.

## Architektur — Reader + Mapper

Pro Source ein Sub-Folder (`slack/`, `jira/`, `intercom/`, `upvoty/`) mit:

- `schema.ts` — Zod-Schema für die Source-Form
- `ids.ts` — deterministische ID-Konstruktoren
- `handle.ts` — `map(item) → ConnectorOutput` (pure Funktion)
- `index.ts` — exportiert eine `ConnectorSpec`

**Reader-Schicht** (`core/snapshot-source.ts`, `core/jsonl-source.ts`) ist austauschbar. Heute lesen alle Connectors einen JSON-Snapshot — wenn morgen Webhooks oder JSONL-Streams kommen, kommt ein zusätzlicher Reader hinzu, der Mapper bleibt.

**Mapper-Schicht** ist der semantische Vertrag: Source-Item → Liste von Emissions, die der Runner via `messaging.publish()` ans Bus schickt.

## Records und Edges pro Source

| Source                   | Records                               | Edges                                      |
| ------------------------ | ------------------------------------- | ------------------------------------------ |
| **slack**                | channel, user, message                | `posted_in`, `authored_by`, `replies_to`   |
| **jira**                 | project, board, sprint, issue         | `posted_in`, `belongs_to_sprint`           |
| **intercom** _(Skelett)_ | conversation, contact, agent, message | `posted_in`, `authored_by`, `assigned_to`  |
| **upvoty** _(Skelett)_   | board, user, post, comment            | `posted_in`, `authored_by`, `commented_on` |

## Annahmen / Lücken (Diskussion mit Daten-Generator)

| Source | Annahme oder Lücke                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| slack  | Mock liefert keinen `team_id`/Workspace → wir defaulten auf `"hackathon"`. IDs bleiben deterministisch und re-runbar.                                                                                                                                                                                                                                         |
| slack  | Mock liefert keine Bot-/External-Flags → User-Records haben `is_bot: false`, `is_external: false` hardcoded. Sobald die Mocks das ergänzen, hier einlesen.                                                                                                                                                                                                    |
| slack  | Reactions sind im Mock, aber Z1 hat dafür keinen Edge-Typ → werden vorerst nicht emittiert.                                                                                                                                                                                                                                                                   |
| slack  | User-Tags aus `mentions: [...]` werden im Record-Payload mitgegeben, aber **nicht** als Edge emittiert. Das ist Aufgabe der „Referenzen Extrahiert"-Box am EventStream (Mention-Extractor, Z7) — sie scannt Body und kann ein `<@U…>`-Pattern für Slack-User ergänzen. So bleiben alle Mentions-Edges (User-Tags und Cross-Source-Verweise) bei einem Worker. |
| jira   | Issue-/Project-IDs nutzen den Key (`SHOP-142`). Im Pilot mit Mocks ohne Project-Moves ausreichend; in Produktion müssten wir die numerische `id` aus der Source-API verwenden.                                                                                                                                                                                |
| jira   | Issues haben kein `created_at` im Mock → Sprint-`startDate` wird als plausibles `occurred_at` verwendet.                                                                                                                                                                                                                                                      |
| jira   | Datetime-Felder kommen mit lokalem Offset (`+02:00`); messaging erwartet UTC-`Z` → wir normalisieren mit `new Date(...).toISOString()`.                                                                                                                                                                                                                       |
| jira   | Comments haben nur `authorRole`, keine User-ID → werden vorerst **nicht** emittiert. Sobald Author-IDs vorliegen, additiv ergänzen.                                                                                                                                                                                                                           |
| upvoty | Vote-Beziehungen werden nicht emittiert — `EdgeType` aus Z1 hat kein `voted_by`. Mit Datenmodell-Owner klären.                                                                                                                                                                                                                                                |
| alle   | Lifecycle (`record.updated`, `record.deleted`) wird vom Code unterstützt, von den Mocks aber nicht ausgelöst — nur `observed` heute.                                                                                                                                                                                                                          |
| alle   | Strukturelle Edges einer Cascade (Record + zugehörige Edges) tragen `causation_id` auf das Record-Event — Provenance vom Edge zurück zum Auslöser ist traversierbar (Z2).                                                                                                                                                                                     |

## Lokal ausprobieren

```bash
# Preview (stdout, kein NATS nötig)
pnpm --filter @repo/connectors run slack ../../fixtures
pnpm --filter @repo/connectors run jira  ../../fixtures

# Echtes Publishing ans Bus
docker compose up -d nats        # NATS muss laufen
pnpm --filter @repo/messaging provision   # Stream und Demo-Consumer einmal anlegen
pnpm --filter @repo/connectors run slack ../../fixtures --publish
```

## Tests

```bash
pnpm --filter @repo/connectors test
```

Slack/Jira testen gegen die echten Mocks unter `fixtures/`. Intercom/Upvoty haben Inline-Fixtures, weil reale Mocks noch fehlen.
