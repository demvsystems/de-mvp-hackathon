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

## Stand der Mapper

Alle vier Connectors sind produktiv im Sinne des Pilots: Records, strukturelle Edges, Lifecycle-Updates und Löschungen werden emittiert. Frühere „Skelett"-Marker für Intercom/Upvoty sind erledigt — die Snapshots sind über den `pwx-splitter` (siehe unten) aus den `pwx_ideen_*`-Containern abgeleitet, und die Mapper rollen `updates[]`-Arrays zu `record.updated`-Events ab.

| Source       | Records                               | Edges                                      | Lifecycle                                                     |
| ------------ | ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| **slack**    | channel, user, message                | `posted_in`, `authored_by`, `replies_to`   | `record.updated` (Edits), `record.tombstoned` (Löschungen)    |
| **jira**     | project, board, sprint, issue         | `posted_in`, `belongs_to_sprint`           | `record.updated` (Issue-Updates), `record.deleted`            |
| **intercom** | conversation, contact, agent, message | `posted_in`, `authored_by`, `assigned_to`  | `record.updated` (Conv-State/Tags/Assignee), `record.deleted` |
| **upvoty**   | board, user, post, comment            | `posted_in`, `authored_by`, `commented_on` | `record.updated` (Status/Title/Body), `record.deleted`        |

### Body-Anreicherung im Cluster-Anker

Damit Embedder/Topic-Discovery den Konversationskontext sehen, hängen alle Connectors die Kind-Bodies zusätzlich an den jeweiligen Container-Record an. Replies/Parts/Comments bleiben trotzdem als eigene Records mit ihrem eigenen Body emittiert — die Anreicherung ist nur am Cluster-Anker.

| Source   | Anker         | angehängt                                                                                       |
| -------- | ------------- | ----------------------------------------------------------------------------------------------- |
| slack    | Top-Level-Msg | Thread-Reply-Texte (rekursiv flach)                                                             |
| jira     | Issue         | Kommentar-Bodies mit `[authorRole]`-Prefix                                                      |
| intercom | Conversation  | Parts-Bodies                                                                                    |
| upvoty   | Post          | Comment-Bodies (ohne `is_internal: true` — Team-Notes bleiben außerhalb des Embedding-Kontexts) |

### Provenance & Korrelation

- Strukturelle Edges einer Cascade (Record + zugehörige Edges) tragen `causation_id` auf das Record-Event — Provenance vom Edge zurück zum Auslöser ist traversierbar (Z2).
- `record.updated`/`record.deleted`/`record.tombstoned` einer Cascade tragen `causation_id` auf das initiale `record.observed`.
- Top-Level-Messages/Conversations/Posts setzen `correlation_id = subject_id`; Replies/Parts/Comments erben den Anker.

## Annahmen / offene Punkte

| Source   | Annahme oder Lücke                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| slack    | Mock liefert keinen `team_id`/Workspace → wir defaulten auf `"hackathon"`. IDs bleiben deterministisch und re-runbar.                                                                                                                                                                                                                                                                                                                                  |
| slack    | Mock liefert keine Bot-/External-Flags → User-Records haben `is_bot: false`, `is_external: false` hardcoded. Sobald die Mocks die Felder ergänzen, hier einlesen.                                                                                                                                                                                                                                                                                      |
| slack    | Reactions sind im Mock, aber Z1 hat dafür keinen Edge-Typ → werden vorerst nicht emittiert.                                                                                                                                                                                                                                                                                                                                                            |
| slack    | User-Tags aus `mentions: [...]` werden im Record-Payload mitgegeben, aber **nicht** als Edge emittiert. Das ist Aufgabe der „Referenzen Extrahiert"-Box am EventStream (Mention-Extractor, Z7) — sie scannt Body und kann ein `<@U…>`-Pattern für Slack-User ergänzen. So bleiben alle Mentions-Edges (User-Tags und Cross-Source-Verweise) bei einem Worker.                                                                                          |
| jira     | Issue-/Project-IDs nutzen den Key (`SHOP-142`). Im Pilot mit Mocks ohne Project-Moves ausreichend; in Produktion müssten wir die numerische `id` aus der Source-API verwenden.                                                                                                                                                                                                                                                                         |
| jira     | Issues haben kein `created_at` im Mock → Sprint-`startDate` wird als plausibles `occurred_at` verwendet. Issues **ohne** Sprint (z. B. `BILLING-77`) fallen auf `now` zurück — bei Re-Runs wandert `occurred_at` mit; akzeptabel im Pilot, in Produktion muss ein stabiler Fallback her.                                                                                                                                                               |
| jira     | Datetime-Felder kommen mit lokalem Offset (`+02:00`); messaging erwartet UTC-`Z` → wir normalisieren mit `new Date(...).toISOString()`.                                                                                                                                                                                                                                                                                                                |
| jira     | Comments haben nur `authorRole`, keine User-ID → werden vorerst **nicht** als eigene Records emittiert. Bodies hängen mit Rollen-Prefix am Issue-Body. Sobald Author-IDs vorliegen, additiv ergänzen.                                                                                                                                                                                                                                                  |
| jira     | Im Pilot-Mock hat nur `SHOP` ein Board und einen aktiven Sprint; `BILLING` taucht ohne Board/Sprint auf. Mapper kommt damit klar (Project-Record ohne Cascade), aber wer den Mock liest, sollte das nicht für ein Schema-Limit halten.                                                                                                                                                                                                                 |
| slack    | Edits in Thread-Replies (siehe `msg_002_reply_001`) werden als `record.updated` auf den Reply emittiert — der angereicherte **Top-Level-Body** zieht aber nur den aktuellen Reply-`text`, nicht die Edit-Historie. Wer den Konversationsverlauf rekonstruieren will, muss die Reply-Edits separat lesen.                                                                                                                                               |
| upvoty   | Vote-Beziehungen werden nicht als Edge emittiert — `EdgeType` aus Z1 hat kein `voted_by`. Stattdessen liegen `vote_count`, `voter_count` **und** `voter_ids: string[]` im Post-Payload, sodass Down-Stream-Worker (Power-Voter, Topic-Discovery) damit arbeiten können. Sobald Z1 `voted_by` ergänzt, kann ein additiver Schritt die Edges aus diesem Feld erzeugen. Voter selbst werden als User-Records emittiert (alle `users[]` aus dem Snapshot). |
| upvoty   | User-Klassifikation aus `role`: `admin`/`team` → `is_internal: true`, `customer`/fehlend → `is_external: true`. Anonyme Voter (Cookie-Token in der echten API) tauchen nur im `voter_ids`-Array eines Posts auf, falls Upvoty sie liefert — sie haben keinen User-Record, solange sie nicht in `users[]` aufgelöst sind.                                                                                                                               |
| upvoty   | Nested Comments (`parent_id`) bleiben als flache `commented_on → Post`-Edge im Graph; der `parent_comment_id` wird als Payload-Feld durchgereicht. Edge-Vokabular hat heute kein `replies_to` für Upvoty-Comments — sobald Bedarf da ist, additiv ergänzen.                                                                                                                                                                                            |
| upvoty   | `merged_into_id` (AI-/Admin-Merge) liegt im Post-Payload, wird aber **nicht** als Edge emittiert. Sobald Z1 einen Merge-Edge-Typ hat, additiv ergänzen.                                                                                                                                                                                                                                                                                                |
| upvoty   | Status-Werte werden als String durchgereicht (kanonisch `under_review`/`planned`/`in_progress`/`live`/`closed`, plus Custom-Statuses pro Board). Der Mapper kennt kein Enum, damit tenant-spezifische Workflows nicht hart zu validieren sind.                                                                                                                                                                                                         |
| upvoty   | Cluster-Anker-Body fällt auf den Original-`body` durch, wenn der Post keine Comments hat (z. B. `post_2003`). Symmetrisch: ohne `body` und ohne Comments ist der Body `null`.                                                                                                                                                                                                                                                                          |
| intercom | `IntercomActor.type` kennt `'user' \| 'admin' \| 'bot'`, aber `actorSubjectId` mappt nur `'admin' → agentId`, alles andere → `contactId`. Bots würden also als Contacts emittiert. Im aktuellen Mock kommen keine Bots vor — latente Falle, sobald Bot-Parts auftauchen.                                                                                                                                                                               |
| intercom | `assignee_id: null` ≠ `undefined` ist semantisch relevant: `null` heißt „explizit nicht zugewiesen" (z. B. in `conv_9001 updates[0].previous`), `undefined` heißt „Feld unverändert". Mapper unterscheidet bewusst (`!== undefined` statt `??`). Gleiches gilt für `subject`.                                                                                                                                                                          |
| alle     | Lifecycle wird vollständig unterstützt: `updates[]`-Arrays in den Fixtures werden zu `record.updated`-Events abgerollt (rückwärts rekonstruiert via `previous`-Slices), `deleted_at` triggert `record.deleted` (bzw. `record.tombstoned` bei Slack — Slack-Edits bleiben sichtbar, der Body wird leer).                                                                                                                                                |

## pwx-splitter — Container → per-Source-Snapshots

`apps/playground/Dummyfiles/pwx_ideen_*.json` sind Cluster-Container mit einer Section pro Source (Slack/Jira im API-Format, Intercom als Webhook-Stream, Upvoty mit separaten posts/comments/votes-Listen). Der Splitter konvertiert sie ins Snapshot-Schema des jeweiligen Connectors.

```bash
# Default: liest aus apps/playground/Dummyfiles, schreibt nach
# apps/playground/Dummyfiles/pwx-clusters/<cluster>/{slack,jira,intercom,upvoty}.json
pnpm --filter @repo/connectors run pwx:split

# Mit eigenen Pfaden
pnpm --filter @repo/connectors run pwx:split -- --in <dir> --out <dir>
```

Adapter pro Source liegen in `src/pwx-splitter/{slack,jira,intercom,upvoty}.ts` mit eigenen Tests. Fehlt eine Section im Container, wird die entsprechende Datei nicht geschrieben.

## Lokal ausprobieren

```bash
# Preview (stdout, kein NATS nötig) — liest aus fixtures/ als Default
pnpm connectors:slack
pnpm connectors:jira
pnpm connectors:intercom
pnpm connectors:upvoty

# Override des data-dir
pnpm connectors:slack apps/playground/Dummyfiles/pwx-clusters/bipro_bestandsuebertragung

# Echtes Publishing ans Bus
docker compose up -d nats                          # NATS muss laufen
pnpm --filter @repo/messaging provision            # Stream und Demo-Consumer einmal anlegen
pnpm connectors:slack -- --publish                 # `--` vor dem Flag, sonst frisst pnpm es
```

## Tests

```bash
pnpm --filter @repo/connectors test
```

Testabdeckung pro Connector:

- `handle.test.ts` — Mapping-Verhalten gegen reale (Slack/Jira) bzw. abgeleitete (Intercom/Upvoty) Fixtures, Idempotenz, Lifecycle-Cascades, Causation-Ketten.
- `expected-links.test.ts` — Cross-Source-Erwartungen aus `fixtures/expected-links.json`.
- `fixture-conformance.test.ts` — alle Fixtures parsen gegen ihre Schemas.
- `pwx-splitter/*.test.ts` — Adapter-spezifische Tests pro Source.
