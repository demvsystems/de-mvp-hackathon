# Zettel 2 — Connectors

Vier Worker, die externe Quellen in den Event-Stream übersetzen. Im Pilot mit synthetischen Payloads, in Produktion gegen echte Source-APIs. Der Connector-Vertrag bleibt identisch — der Übergang ist additiv.

---

## Was

Pro Quelle ein eigener Worker. Vier Connectors im Pilot:

- `slack-connector`
- `github-connector`
- `jira-connector`
- `confluence-connector`

**Verantwortung pro Connector.**

- Source-Payload entgegennehmen oder einlesen (im Pilot aus Files)
- Validieren gegen das erwartete Source-Schema
- Deterministische IDs für Records, User, Container und Edges berechnen
- Events mit Envelope und Payload-Schema erzeugen
- Ins NATS publishen mit `msgID` für Idempotenz

**Was Connectors _nicht_ tun.** Keine Inferenz aus dem Body, keine Embedding-Lookups, keine Topic-Zuordnung. Sie emittieren nur Source-Wahrheit — was die Quell-API als strukturierte Felder liefert.

**Stack pro Connector.**

- TypeScript/Node
- `@nats-io/transport-node` und `@nats-io/jetstream`
- Eigenes Zod-Schema pro Source-Payload-Form
- Im Pilot: Filesystem-Watcher oder einfacher CLI-Trigger statt API

## Wie

### Repository-Layout der synthetischen Daten

Pro Quelle ein eigenes Verzeichnis, darunter Files pro Record-Typ. Beispiel:

```
synthetic-data/
├── slack/
│   ├── workspaces.jsonl       # Workspace-Definitionen
│   ├── channels.jsonl         # Channel-Records
│   ├── users.jsonl            # User-Records
│   └── messages.jsonl         # Message-Records (mit thread_ts für Threading)
├── github/
│   ├── repos.jsonl
│   ├── users.jsonl
│   ├── issues.jsonl
│   └── pulls.jsonl
├── jira/
│   ├── projects.jsonl
│   ├── sprints.jsonl
│   ├── users.jsonl
│   └── issues.jsonl
└── confluence/
    ├── spaces.jsonl
    ├── users.jsonl
    ├── pages.jsonl
    └── comments.jsonl
```

**Format.** JSON Lines (`.jsonl`) — eine Zeile ein Record. Macht Streaming-Verarbeitung trivial und vermeidet riesige JSON-Dokumente. Jeder Record hat ein `_meta`-Feld mit Verarbeitungs-Hinweisen für den Connector:

```jsonl
{"_meta": {"emit_at_offset_seconds": 0}, "ts": "1714028000.001234", "channel": "C02DEF", "user": "U01ALICE", "text": "..."}
{"_meta": {"emit_at_offset_seconds": 600}, "ts": "1714028591.012345", "channel": "C02DEF", "user": "U01BOB", "text": "...", "thread_ts": "1714028000.001234"}
```

`emit_at_offset_seconds` ist die Zeit-Verschiebung gegenüber einem Lauf-Start. Damit lassen sich realistische Zeitabstände simulieren (etwa "BiPro-Datenverlust eskaliert über drei Monate").

### Zwei Lauf-Modi

**Streaming-Modus.** Connector startet, liest die Files Zeile für Zeile, hält pro Record `emit_at_offset_seconds` ein und published Events kontinuierlich. Realistisch für End-to-End-Tests, langsam für schnelle Iteration.

**Batch-Modus.** Connector liest alle Files am Stück und published alle Events sofort. Schnell für Eval-Runs und Ergebnis-Reproduktion. Out-of-Order-Handling im Materializer (LWW by `occurred_at`) sorgt dafür, dass der End-State identisch zum Streaming-Modus ist.

Modus wird über CLI-Flag oder Env-Variable gesetzt:

```bash
slack-connector --mode=streaming --data=./synthetic-data/slack
slack-connector --mode=batch     --data=./synthetic-data/slack
```

### Pro Record: drei Schritte

1. **Source-Payload validieren.** Jeder Connector hat ein Zod-Schema für sein Source-Format. Bei Mismatch: Error logging, Record überspringen. Im Pilot ist das deterministisch — das Schema kommt vom Daten-Generator und wird mitgepflegt.

2. **IDs konstruieren.** Pro Record-Typ deterministische Konstruktions-Regel. Diese Regeln sind das Herzstück des Connectors — sie machen Idempotenz möglich.

3. **Events emittieren.** Typischerweise ein `record.observed`-Event plus mehrere `edge.observed`-Events für die strukturellen Beziehungen.

### ID-Konstruktion pro Source

Allgemeines Schema: `<source>:<kind>:<source-native-id>`. Die `source-native-id` muss stabil sein über die Lebenszeit des Records — nicht der menschen-lesbare Name (Jira-Key kann sich bei Project-Move ändern), sondern die unveränderliche numerische ID.

**Slack.**

- Workspace: `slack:workspace:T01ABC`
- Channel: `slack:channel:T01ABC/C02DEF`
- User: `slack:user:T01ABC/U01ALICE`
- Message: `slack:msg:T01ABC/C02DEF/1714028591.012345` (Workspace + Channel + ts)
- Thread: erkannt über `thread_ts != ts`, ID des Parents ist `slack:msg:T01ABC/C02DEF/<thread_ts>`

**GitHub.**

- Repo: `github:repo:onboardflow/api`
- User: `github:user:U_kgDOA1234` (Node-ID, nicht Login — Login kann sich ändern)
- Issue: `github:issue:onboardflow/api/42`
- Pull-Request: `github:pr:onboardflow/api/55`
- Comment: `github:comment:onboardflow/api/issues/42/comments/123456`

**Jira.**

- Project: `jira:project:DEMV` (oder numerisch — hier ist die Praxis uneinheitlich; im Pilot reicht der Key)
- Sprint: `jira:sprint:12` (numerische Sprint-ID)
- User: `jira:user:712020:abc12345-...` (Atlassian Account-ID, nicht E-Mail)
- Issue: `jira:issue:10042` (numerische Issue-ID, nicht Key — Key kann sich bei Project-Move ändern)
- Comment: `jira:comment:10042/200500`

**Confluence.**

- Space: `confluence:space:ONBOARD`
- Page: `confluence:page:8723645` (numerische Page-ID)
- Comment: `confluence:comment:9123456` (numerische Comment-ID)
- User: `confluence:user:abc-def-456` (Atlassian Account-ID)

### Edge-Erzeugung pro Source

Strukturelle Edges entstehen aus Feldern, die die Source explizit liefert. Pro Source eine Übersicht:

**Slack.**
| Edge | Quelle |
|---|---|
| `authored_by` | `user`-Feld der Message |
| `posted_in` | `channel`-Feld |
| `replies_to` | `thread_ts` (wenn ungleich `ts`) |

**GitHub.**
| Edge | Quelle |
|---|---|
| `authored_by` | `user.node_id` |
| `posted_in` | Repo-Kontext |
| `assigned_to` | `assignee.node_id` (pro Assignee bei mehreren) |
| `references` | `linked_issues` aus der Timeline-API (Closes/Fixes-Beziehungen) |

**Jira.**
| Edge | Quelle |
|---|---|
| `authored_by` | `creator.accountId` |
| `posted_in` | `project.id` |
| `assigned_to` | `assignee.accountId` |
| `belongs_to_sprint` | `customfield_10020` (Sprint-Custom-Field), aktiver Sprint |
| `child_of` | `parent.id` (bei Subtasks) |
| `references` | `issuelinks` (Blocks, Relates, etc., mit Type im `evidence`-Feld) |

**Confluence.**
| Edge | Quelle |
|---|---|
| `authored_by` | `history.createdBy.accountId` |
| `posted_in` | `space.key` |
| `child_of` | `ancestors[0]` (unmittelbarer Parent) |
| `commented_on` | bei Comment-Records: `parent_page_id` |
| `replies_to` | bei Comment-Records: `parent_comment_id` (wenn Reply) |

Für Pull-Requests in GitHub gilt zusätzlich, dass sie als Records mit `type: "pr"` behandelt werden und sonst dieselben Edges wie Issues bekommen, plus eine `references`-Edge zu dem Issue, das der PR schließt (aus `linked_issues`).

### Pro Record-Event: Causation-Kette

Edges, die zu einem Record gehören, bekommen `causation_id` auf das Record-Event. Damit ist die Provenance traversierbar — vom Edge zurück zum auslösenden Event.

```
record.observed (event_id: evt_a3f9c8d2e7b1)
  └─> edge.observed (authored_by, causation_id: evt_a3f9c8d2e7b1)
  └─> edge.observed (posted_in, causation_id: evt_a3f9c8d2e7b1)
  └─> edge.observed (replies_to, causation_id: evt_a3f9c8d2e7b1)
```

Der Connector kann diese Events parallel publishen — Reihenfolge ist nicht garantiert. Der Materializer löst das über das LWW-Pattern auf.

### Updates an Records und Edges

Wenn die Source eine Änderung meldet (etwa eine Slack-Message wird editiert oder ein Jira-Sprint-Wechsel passiert), emittiert der Connector ein `record.updated`-Event mit dem neuen vollständigen Snapshot. Im Pilot mit Option A (vollständige Snapshots, kein Patch-Format) ist die Materializer-Logik trivial — UPSERT mit LWW.

Bei Edge-Updates (etwa Sprint-Wechsel) emittiert der Connector zwei Events: erst die alte Edge mit `valid_to` befüllt (Invalidierung), dann die neue Edge offen.

### Bot-User und externe User

Manche User sind Bots oder externe Personen (Customer-Community-Mitglieder). Der Connector entscheidet das aus Source-Feldern und setzt entsprechende Flags im User-Record:

```json
{
  "id": "slack:user:T01ABC/B01BOT",
  "type": "user",
  "source": "slack",
  "payload": {
    "is_bot": true,
    "is_external": false,
    "display_name": "GitHub-Notifications",
    "real_name": null
  }
}
```

Der Bewerter kann später optional Bot-Aktivität ausfiltern. Im Pilot werden Bots normal behandelt — eine Bot-User-ID ist genauso valid wie eine menschliche.

## Warum

**Warum ein Worker pro Quelle, kein Plugin-System?** Die Sources unterscheiden sich genug, dass ein generisches Plugin-System mehr Komplexität als Nutzen brächte. Slack hat Threading, GitHub hat PRs als Issue-Variante, Jira hat Sprint-Custom-Fields, Confluence hat Hierarchie. Diese Spezifika in einer abstrakten Connector-Engine zu kapseln führt zu Generic-Code, der schwerer zu lesen und zu testen ist als vier eigenständige Worker. Der gemeinsame Vertrag (Event-Schema, ID-Schema, Edge-Klassen) ist die einzige Abstraktion, die wir brauchen.

**Warum synthetische Payloads im Pilot?** Echte API-Anbindung bringt eine eigene Klasse von Problemen — Auth, Rate-Limiting, Webhook-Retries, Pagination, Schema-Drift. Im Pilot wollen wir die Hypothese testen, nicht Connector-Robustheit beweisen. Synthetische Daten sind reproduzierbar, lassen sich für Eval-Goldstandards präzise konstruieren, und der Connector-Vertrag bleibt für den späteren Übergang zu echten APIs identisch.

**Warum JSON Lines statt JSON?** JSON-Lines sind streaming-verarbeitbar (Zeile für Zeile, ohne den ganzen File in Memory zu halten), Diff-freundlich (Git zeigt nur die geänderten Zeilen), und einfach generierbar. Bei mehreren tausend synthetischen Records ist das spürbar besser als ein riesiges JSON-Array.

**Warum `_meta` mit Offset-Zeiten?** Realistische Eskalations-Szenarien brauchen zeitliche Verteilung. "BiPro-Datenverlust eskaliert über drei Monate" lässt sich nur testen, wenn die Records auch tatsächlich über drei Monate verteilt sind. Mit `emit_at_offset_seconds` und einer Zeit-Skalierung im Connector (etwa "1 Sekunde Realzeit = 1 Stunde Datenzeit") sind solche Szenarien in vertretbarer Test-Zeit durchspielbar.

**Warum stabile Source-IDs statt Login-Namen?** Login-Namen ändern sich (jemand heiratet, Account wird umbenannt). Numerische oder UUID-IDs sind stabil. Wenn unser System einen User über seine Login-ID adressiert, würde nach einem Rename die Identität verloren gehen — alle alten Edges würden ins Leere zeigen. Die Source-API liefert stabile IDs (Slack-Workspace+User-ID, GitHub-Node-ID, Atlassian-AccountId), und genau die nutzen wir.

**Warum Edges parallel zum Record-Event publishen, nicht eingebettet?** Das Materializer-Pattern arbeitet pro Event. Eingebettete Edges würden bedeuten, dass der Materializer pro Record-Event mehrere Tabellen-Operationen macht — komplizierter, fehleranfälliger. Mit separaten Edge-Events bleibt jeder Handler einfach: ein Event, eine Operation. Idempotenz ist über deterministische IDs gegeben.

## Beispiele

### Beispiel 1: Slack-Reply in einem Thread

Source-Payload (aus `synthetic-data/slack/messages.jsonl`):

```jsonl
{
  "_meta": {
    "emit_at_offset_seconds": 600
  },
  "ts": "1714028591.012345",
  "team": "T01ABC",
  "channel": "C02DEF",
  "user": "U01BOB",
  "text": "Stimmt — und der gleiche Einwand kam letzte Woche schon...",
  "thread_ts": "1714028000.001234"
}
```

Daraus emittiert der Connector vier Events:

```typescript
// 1. Record-Event
const recordEvent = {
  event_type: 'record.observed',
  subject_kind: 'record',
  subject_id: 'slack:msg:T01ABC/C02DEF/1714028591.012345',
  source: 'slack',
  occurred_at: '2026-04-15T09:23:11.000Z',
  payload: {
    id: 'slack:msg:T01ABC/C02DEF/1714028591.012345',
    type: 'message',
    source: 'slack',
    title: null,
    body: 'Stimmt — und der gleiche Einwand kam letzte Woche schon...',
    payload: {
      workspace_id: 'T01ABC',
      channel_id: 'C02DEF',
      ts: '1714028591.012345',
      thread_ts: '1714028000.001234',
      author_id: 'U01BOB',
    },
    created_at: '2026-04-15T09:23:11.000Z',
    updated_at: '2026-04-15T09:23:11.000Z',
  },
};

// 2. authored_by-Edge
const authorEdge = {
  event_type: 'edge.observed',
  subject_kind: 'edge',
  subject_id:
    'edge:authored_by:slack:msg:T01ABC/C02DEF/1714028591.012345->slack:user:T01ABC/U01BOB',
  source: 'slack',
  causation_id: recordEvent.event_id,
  payload: {
    from_id: 'slack:msg:T01ABC/C02DEF/1714028591.012345',
    to_id: 'slack:user:T01ABC/U01BOB',
    type: 'authored_by',
    source: 'slack:v1',
    confidence: 1.0,
    valid_from: '2026-04-15T09:23:11.000Z',
    valid_to: null,
  },
};

// 3. posted_in-Edge zum Channel
const channelEdge = {
  // ... posted_in zu slack:channel:T01ABC/C02DEF
};

// 4. replies_to-Edge (wegen thread_ts)
const replyEdge = {
  // ... replies_to zu slack:msg:T01ABC/C02DEF/1714028000.001234
};

await Promise.all([
  publish('events.record.observed.slack', recordEvent),
  publish('events.edge.observed.slack', authorEdge),
  publish('events.edge.observed.slack', channelEdge),
  publish('events.edge.observed.slack', replyEdge),
]);
```

### Beispiel 2: Jira-Sprint-Wechsel

Wenn die Source-Payload zeigt, dass sich der Sprint geändert hat, emittiert der Connector zwei Edge-Events:

```typescript
// Alte Edge invalidieren
const oldSprintEdge = {
  event_type: 'edge.observed',
  payload: {
    from_id: 'jira:issue:10042',
    to_id: 'jira:sprint:12',
    type: 'belongs_to_sprint',
    source: 'jira:v1',
    confidence: 1.0,
    valid_from: '2026-04-01T00:00:00.000Z',
    valid_to: '2026-04-15T10:00:00.000Z', // jetzt nicht mehr gültig
  },
};

// Neue Edge offen
const newSprintEdge = {
  event_type: 'edge.observed',
  payload: {
    from_id: 'jira:issue:10042',
    to_id: 'jira:sprint:13',
    type: 'belongs_to_sprint',
    source: 'jira:v1',
    confidence: 1.0,
    valid_from: '2026-04-15T10:00:00.000Z',
    valid_to: null,
  },
};
```

### Beispiel 3: Connector-Lauf im Streaming-Modus

```typescript
async function runStreamingConnector(dataDir: string, scaleFactor: number = 60) {
  const startTime = Date.now();
  const records = await loadJsonLines(dataDir);
  records.sort((a, b) => a._meta.emit_at_offset_seconds - b._meta.emit_at_offset_seconds);

  for (const record of records) {
    const targetTime = startTime + (record._meta.emit_at_offset_seconds * 1000) / scaleFactor;
    const wait = Math.max(0, targetTime - Date.now());
    if (wait > 0) await sleep(wait);

    const events = buildEvents(record);
    await Promise.all(events.map((e) => publishEvent(e)));
  }
}
```

`scaleFactor: 60` bedeutet: 1 Sekunde Realzeit = 1 Minute Datenzeit. Drei Monate Daten laufen so in etwa 36 Stunden ab. Für schnellere Tests höher, für realistische End-to-End-Tests niedriger.

## Cross-Links

- Event-Format und Schemas: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Was der Materializer mit den Events macht: [Zettel 3 — Materialisierer](./03_materialisierer.md)
- Inferierte Edges (komplementär zu strukturellen): [Zettel 7 — Mention-Extractor](./07_mention_extractor.md)
