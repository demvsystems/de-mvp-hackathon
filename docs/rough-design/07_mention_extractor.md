# Zettel 7 — Mention-Extractor

Erkennt Cross-Source-Verweise im Body von Records und schreibt sie als `mentions`-Edges. Im Pilot ausschließlich Regex-basiert — eindeutige Pattern wie Jira-Keys, GitHub-Issue-Referenzen, Slack-Permalinks, Confluence-URLs.

---

## Was

**Verantwortung.** Pro neuem Record den Body nach bekannten Pattern scannen und für jeden Treffer eine `mentions`-Edge in den Stream emittieren. Confidence pro Pattern dokumentiert.

**Stack.**

- TypeScript/Node, ein Worker
- JetStream Durable Consumer mit Subject-Filter `events.record.observed.>` und `events.record.updated.>`
- Pattern-Registry als Konfigurations-Datei
- Kein LLM, keine Embedding-Lookups

**Was er schreibt.**

- `events.edge.observed.mention-extractor-regex` für jede gefundene Mention
- Edge mit `type: "mentions"`, `source: "mention-extractor:regex:v1"`, Confidence aus Pattern-Definition

**Was er nicht tut.**

- Keine kontextuelle Erkennung (etwa "der Pricing-Refactor" ohne explizite ID) — das wäre LLM-Aufgabe und ist Phase 2
- Keine semantische Disambiguierung (Pattern matched eindeutig oder nicht)
- Keine Validierung, ob das Ziel-Record existiert

## Wie

### Pattern-Registry

Zentrale Konfigurations-Datei mit allen Patterns. Pro Pattern:

- Name (für Debugging und Provenance)
- Regex
- Confidence (typisch 0.90–0.99 je nach Pattern-Eindeutigkeit)
- Übersetzungs-Funktion: aus Match-Gruppen die kanonische Target-ID bauen

```typescript
type MentionPattern = {
  name: string;
  regex: RegExp;
  confidence: number;
  buildTargetId: (match: RegExpMatchArray) => string | null;
  applyTo?: {
    sources?: string[]; // welche Source-Records gescannt werden (default: alle)
  };
};

const PATTERNS: MentionPattern[] = [
  // Jira-Keys: PRICE-42, DEMV-4127
  {
    name: 'jira_key',
    regex: /\b([A-Z][A-Z0-9]+)-(\d+)\b/g,
    confidence: 0.95,
    buildTargetId: async (match) => {
      // Key zu numerischer Issue-ID auflösen
      const key = `${match[1]}-${match[2]}`;
      return await resolveJiraKey(key); // gegen records-Tabelle
    },
  },

  // GitHub-Issue-Shortform: owner/repo#42
  {
    name: 'github_issue_shortform',
    regex: /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g,
    confidence: 0.97,
    buildTargetId: (match) => `github:issue:${match[1]}/${match[2]}/${match[3]}`,
  },

  // GitHub-PR-URL
  {
    name: 'github_pr_url',
    regex: /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g,
    confidence: 0.99,
    buildTargetId: (match) => `github:pr:${match[1]}/${match[2]}/${match[3]}`,
  },

  // GitHub-Issue-URL
  {
    name: 'github_issue_url',
    regex: /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/g,
    confidence: 0.99,
    buildTargetId: (match) => `github:issue:${match[1]}/${match[2]}/${match[3]}`,
  },

  // Slack-Permalink
  {
    name: 'slack_permalink',
    regex: /https:\/\/[\w.-]+\.slack\.com\/archives\/([CG]\w+)\/p(\d+)/g,
    confidence: 0.99,
    buildTargetId: async (match) => {
      // Permalink-Format: workspace.slack.com/archives/<channel>/p<ts-without-dot>
      // Workspace-ID muss aus URL-Subdomain oder DB-Lookup
      const channelId = match[1];
      const tsCompact = match[2];
      const ts = `${tsCompact.slice(0, 10)}.${tsCompact.slice(10)}`;
      return await resolveSlackChannelToWorkspace(channelId, ts);
    },
  },

  // Confluence-Page-URL
  {
    name: 'confluence_page_url',
    regex: /\/wiki\/spaces\/([A-Z]+)\/pages\/(\d+)/g,
    confidence: 0.99,
    buildTargetId: (match) => `confluence:page:${match[2]}`,
  },

  // Confluence-Comment-URL (mit fragment)
  {
    name: 'confluence_comment_url',
    regex: /\/wiki\/spaces\/[A-Z]+\/pages\/\d+[^#]*#comment-(\d+)/g,
    confidence: 0.99,
    buildTargetId: (match) => `confluence:comment:${match[1]}`,
  },

  // Hashtag-style Jira-Mention (manchmal in Slack-Diskussionen üblich)
  {
    name: 'jira_hashtag',
    regex: /#([A-Z][A-Z0-9]+)-(\d+)\b/g,
    confidence: 0.93,
    buildTargetId: async (match) => {
      const key = `${match[1]}-${match[2]}`;
      return await resolveJiraKey(key);
    },
  },
];
```

Pattern-Registry liegt in einer eigenen Datei (`patterns.ts`), wird beim Worker-Start eingelesen, kann ohne Code-Änderung am Worker erweitert werden.

### Konfusionsfreiheit zwischen Patterns

Patterns dürfen nicht inkonsistent matchen. Beispiel: ein Slack-Permalink (URL) enthält Substrings, die wie Jira-Keys aussehen können — aber wir wollen keine doppelten Edges.

Strategie: Patterns laufen sequentiell, höher-spezifische zuerst. URLs zuerst, Shortforms danach, freie Keys zuletzt. Innerhalb derselben Pattern-Run werden gefundene Match-Spans markiert; nachfolgende Patterns überspringen Bereiche, die schon gematcht wurden.

```typescript
function findMentions(body: string): MentionMatch[] {
  const matches: MentionMatch[] = [];
  const consumed: Array<[number, number]> = []; // [start, end]

  for (const pattern of PATTERNS) {
    // sortiert nach Spezifität
    for (const match of body.matchAll(pattern.regex)) {
      const start = match.index!;
      const end = start + match[0].length;

      // Überlappung mit bereits konsumierten Bereichen?
      if (consumed.some(([s, e]) => start < e && end > s)) continue;

      matches.push({
        pattern_name: pattern.name,
        confidence: pattern.confidence,
        match_text: match[0],
        match_start: start,
        match_end: end,
        target_id_resolver: pattern.buildTargetId,
        match_groups: Array.from(match),
      });

      consumed.push([start, end]);
    }
  }

  return matches;
}
```

### Stub-Resolution für noch nicht ingestierte Targets

Wenn ein Pattern eine Target-ID baut, deren Record noch nicht ingestiert ist, wird die Edge trotzdem geschrieben. Drei Fälle:

**Fall 1: Direkt konstruierbare ID.** Etwa ein Slack-Permalink, der direkt in `slack:msg:<workspace>/<channel>/<ts>` übersetzt wird. Edge wird geschrieben mit dieser ID. Wenn das Ziel später ingestiert wird, wird die Edge automatisch traversierbar — das System hat keine Validierung, aber auch keine Probleme.

**Fall 2: Lookup-bedürftige ID.** Etwa Jira-Key `DEMV-4127`, der numerische ID braucht. Lookup gegen `records.payload->>'key'`. Wenn das Issue noch nicht da ist, kann der Lookup fehlschlagen.

```typescript
async function resolveJiraKey(key: string): Promise<string | null> {
  const result = await db.queryMaybeOne(
    `
    SELECT id FROM records WHERE source = 'jira' AND payload->>'key' = $1
  `,
    [key],
  );

  if (result) return result.id;

  // Stub: kanonische ID kann nicht gebaut werden, weil numerische Issue-ID unbekannt
  return null;
}
```

**Fall 3: Pattern matched, aber Lookup ergibt null.** Edge wird _nicht_ geschrieben — wir haben kein Target. Optional könnte ein Stub-Record mit `is_stub: true` angelegt werden, der später vom Connector aufgelöst wird. Im Pilot lassen wir die Mention vorerst aus; sie wird beim nächsten Re-Run erkannt, sobald das Target da ist.

Pragmatischer Ansatz für den Pilot: bei Cache-Miss wird der Record auf eine Liste "pending mentions" gesetzt. Der Worker hört zusätzlich auf neue Jira-Issues und prüft, ob pending mentions damit aufgelöst werden können.

```typescript
async function processRecord(payload: RecordObservedPayload) {
  if (!payload.body) return;

  const matches = findMentions(payload.body);

  for (const m of matches) {
    const targetId = await m.target_id_resolver(m.match_groups);

    if (!targetId) {
      // Stub: Mention notiert für später
      await markPending(payload.id, m);
      continue;
    }

    await emitMentionEdge(payload, m, targetId);
  }
}

async function processNewJiraIssue(payload: RecordObservedPayload) {
  if (payload.source !== 'jira' || payload.type !== 'issue') return;

  const key = payload.payload?.key as string;
  if (!key) return;

  // Pending Mentions auf diesen Key durchsuchen
  const pending = await db.query(
    `
    SELECT record_id, match_data FROM pending_mentions WHERE jira_key = $1
  `,
    [key],
  );

  for (const p of pending) {
    await emitMentionEdge(reconstructPayload(p), p.match_data, payload.id);
    await db.query(`DELETE FROM pending_mentions WHERE id = $1`, [p.id]);
  }
}
```

`pending_mentions` ist eine kleine Hilfstabelle für nicht-aufgelöste Mentions. Sie ist nicht Teil des Datenmodells, sondern Worker-interner State.

### Worker-Loop

```typescript
const consumer = await js.consumers.get('EVENTS', 'mention-extractor');

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type === 'record.observed' || envelope.event_type === 'record.updated') {
      const payload = RecordObservedPayload.parse(envelope.payload);

      // Container und User skippen
      if (['channel', 'repo', 'project', 'database', 'space', 'user'].includes(payload.type)) {
        msg.ack();
        continue;
      }

      await processRecord(payload, envelope);

      // Pending mentions auflösen, wenn das ein potenzielles Ziel ist
      if (payload.source === 'jira') await processNewJiraIssue(payload);
    }

    msg.ack();
  } catch (err) {
    log.error('mention-extractor error', err);
    msg.nak();
  }
}
```

### Pro Mention: Edge-Emission

```typescript
async function emitMentionEdge(
  fromPayload: RecordObservedPayload,
  match: MentionMatch,
  targetId: string,
) {
  await publishEvent({
    event_type: 'edge.observed',
    subject_kind: 'edge',
    subject_id: `edge:mentions:${fromPayload.id}->${targetId}`,
    source: 'mention-extractor:regex:v1',
    occurred_at: new Date().toISOString(),
    causation_id: deriveCausationId(fromPayload),
    payload: {
      from_id: fromPayload.id,
      to_id: targetId,
      type: 'mentions',
      source: 'mention-extractor:regex:v1',
      confidence: match.confidence,
      weight: 1.0,
      valid_from: fromPayload.created_at,
      valid_to: null,
    },
    evidence: {
      matched_text: match.match_text,
      match_offset_start: match.match_start,
      match_offset_end: match.match_end,
      pattern_name: match.pattern_name,
      extractor_version: 'regex:v1',
    },
  });
}
```

Subject-Routing geht auf `events.edge.observed.mention-extractor-regex`. Materializer hört auf `events.>` und materialisiert es in die `edges`-Tabelle.

### Re-Processing bei Updates

Wenn ein Record aktualisiert wird (`record.updated`), kann sich der Body ändern. Der Worker scannt den neuen Body neu. Existierende Mention-Edges werden via UPSERT behandelt — UNIQUE-Constraint auf `(from_id, to_id, type, source)` macht das idempotent. Wenn eine Mention im neuen Body fehlt, die im alten Body da war, _bleibt die alte Edge vorerst stehen_ — wir haben keinen "aktuellen Body sagt das nicht mehr"-Mechanismus. Im Pilot ist das akzeptabel; in Produktion wäre eine Diff-Logik mit `valid_to`-Setting denkbar.

### Pattern-Erweiterung im laufenden Betrieb

Neue Patterns dazuzunehmen ist eine Code-Änderung in `patterns.ts`. Nach Worker-Restart läuft Pattern auf neuen Records. Für rückwirkende Anwendung auf alte Records:

```typescript
// Replay nur den Mention-Extractor
await jsm.consumers.delete('EVENTS', 'mention-extractor');
await jsm.consumers.add('EVENTS', {
  durable_name: 'mention-extractor',
  filter_subject: 'events.record.>',
  deliver_policy: 'all',
});
```

Der Materializer behandelt UPSERT-Konflikte über das LWW-Pattern. Vorhandene Edges (mit demselben source-tag) werden überschrieben, neue werden eingefügt.

## Warum

**Warum nur Regex im Pilot, kein LLM-Extractor?** Pilot-Pragmatismus. Regex ist deterministisch, schnell, kostenlos pro Lauf, einfach debug-bar. LLM-Extraktion bringt zusätzliche Komplexität (Prompt-Engineering, Kosten, Latenz, Halluzinations-Risiko) und ist im Pilot nicht zwingend nötig — die Goldstandard-Szenarien arbeiten primär mit eindeutigen IDs (Jira-Keys, URLs). Wenn Eval zeigt, dass kontextuelle Erwähnungen ("der Pricing-Refactor") ein systematischer blinder Fleck sind, kommt LLM-Extractor in Phase 2 als zweiter Worker mit eigenem Source-Tag.

**Warum sequentielles Pattern-Matching mit Konfusionsfreiheit?** URLs enthalten oft Substrings, die wie kürzere Patterns aussehen. Ohne Konfusionsfreiheit würden Slack-Permalinks doppelte Edges produzieren — einmal als Permalink, einmal über substring-matching. Sequentiell mit Span-Tracking macht das deterministisch und sauber.

**Warum Stub-Pattern für noch nicht ingestierte Targets?** Realistischer Datenfluss — wenn jemand in Slack auf ein Jira-Issue verweist, das noch nicht ingestiert ist (oder erst in der nächsten Polling-Runde kommt), würde naive Logik die Mention verlieren. Mit `pending_mentions` und Re-Processing bei neuem Target wird die Mention robust erkannt, unabhängig von Ingest-Reihenfolge.

**Warum Pattern-Registry getrennt vom Worker-Code?** Patterns ändern sich häufiger als die Worker-Mechanik. Wenn ein neues Quell-System dazukommt (etwa zusätzlich Discord), kommen neue Patterns dazu, ohne dass der Hauptloop oder Stub-Resolution sich ändern. Die Trennung macht das wartbar.

**Warum Confidence pro Pattern, nicht uniform?** Patterns sind unterschiedlich präzise. Eine vollständige GitHub-URL ist eindeutig (Confidence 0.99), ein bloßer `#42` ohne Kontext könnte auch ein anderes Issue meinen oder gar keine Issue-Referenz sein (Confidence 0.85). Diese Differenzierung erlaubt dem Bewerter, Mention-Edges nach Vertrauen zu gewichten.

**Warum nicht Container-Records skippen?** Container haben oft keinen Body (Slack-Channel ist nur ein Name plus Topic-String, GitHub-Repo ist ein Pfad plus Description). Body-Scan ergibt nichts oder False Positives. Skip ist sauberer.

**Warum Subject-Tag enthält Extractor-Version?** Multi-Source-Pattern. Wenn später ein LLM-Extractor mit Source `mention-extractor:llm:v1` dazukommt, leben Regex- und LLM-Mentions parallel als getrennte Edges. UNIQUE-Constraint auf `(from_id, to_id, type, source)` erlaubt beide, A/B-Vergleich direkt möglich.

**Warum keine Validierung, dass Target existiert?** Aufgabe der Tools, nicht des Extractors. `get_record(target_id)` würde leer zurückgeben, wenn Target nicht da. Materializer schreibt die Edge trotzdem, und sie wird traversierbar, sobald das Target ankommt. Validierung im Extractor würde temporäre False Negatives erzeugen.

## Beispiele

### Beispiel 1: Slack-Reply mit Jira-Key

Body:

```
Stimmt — und der gleiche Einwand kam letzte Woche schon. Ist das DEMV-4127?
```

Pattern-Match:

- `jira_key` matched bei Offset 67–76, Match-Text "DEMV-4127"

Resolver:

```typescript
await resolveJiraKey('DEMV-4127');
// → 'jira:issue:10042' (aus records-Tabelle)
```

Emittiertes Edge-Event:

```json
{
  "event_type": "edge.observed",
  "subject_kind": "edge",
  "subject_id": "edge:mentions:slack:msg:T01ABC/C02DEF/1714028591.012345->jira:issue:10042",
  "source": "mention-extractor:regex:v1",
  "payload": {
    "from_id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
    "to_id": "jira:issue:10042",
    "type": "mentions",
    "source": "mention-extractor:regex:v1",
    "confidence": 0.95,
    "valid_from": "2026-04-15T09:23:11.000Z",
    "valid_to": null
  },
  "evidence": {
    "matched_text": "DEMV-4127",
    "match_offset_start": 67,
    "match_offset_end": 76,
    "pattern_name": "jira_key",
    "extractor_version": "regex:v1"
  }
}
```

### Beispiel 2: GitHub-Issue mit gemischten Referenzen

Body:

```
Same problem as #38 (https://github.com/onboardflow/api/issues/38).
Also related to PRICE-42.
```

Pattern-Matches in Reihenfolge der Spezifität:

1. `github_issue_url` matched die volle URL → consumed[16, 73]
2. `github_issue_shortform` würde auf `#38` matchen — aber es liegt nicht innerhalb consumed. Bei manchen Codierungen ist die `#42`-Form ohne Repo-Kontext nicht eindeutig (welcher Repo?). Hier ist `#38` ohne Owner/Repo — Pattern matched _nicht_ (Pattern verlangt `owner/repo#num`).
3. `jira_key` matched `PRICE-42` → consumed[88, 96]

Zwei Edges werden emittiert:

```
github:issue:onboardflow/api/42 → github:issue:onboardflow/api/38
  pattern: github_issue_url, confidence: 0.99
  matched: "https://github.com/onboardflow/api/issues/38"

github:issue:onboardflow/api/42 → jira:issue:10078  (gelöst über resolver)
  pattern: jira_key, confidence: 0.95
  matched: "PRICE-42"
```

Das `#38` allein produziert keine Edge im Pilot. Begründung: ohne expliziten Repo-Kontext nicht eindeutig auflösbar. Wenn Confluence-Comments oder Slack-Messages häufig diesen Stil nutzen, könnte ein context-aware Pattern in Phase 2 das beheben — etwa basierend auf dem Repo-Kontext des umgebenden Records.

### Beispiel 3: Stub-Mention auf noch nicht ingestiertes Issue

Body:

```
Wie gehen wir mit DEMV-9999 um? Hat das schon jemand priorisiert?
```

Match: `jira_key` matched `DEMV-9999`.

Resolver-Lookup:

```typescript
await resolveJiraKey('DEMV-9999');
// → null  (DEMV-9999 noch nicht ingestiert)
```

Worker schreibt in `pending_mentions`:

```sql
INSERT INTO pending_mentions (record_id, jira_key, match_data, created_at)
VALUES ('slack:msg:...', 'DEMV-9999', '{"pattern":"jira_key","offset":[20,29], ...}', now());
```

Drei Tage später wird DEMV-9999 ingestiert (`record.observed` für Jira-Issue). Worker erkennt das, schaut in `pending_mentions` nach diesem Key und emittiert die Edge:

```
slack:msg:... → jira:issue:11005  (gelöst über late binding)
  pattern: jira_key, confidence: 0.95
  matched: "DEMV-9999"
  evidence: { ..., resolved_late: true }
```

### Beispiel 4: Re-Processing bei Body-Update

Slack-Message wurde editiert. Der Connector emittiert `record.updated` mit dem neuen Body:

```
Alter Body: "Ist das eigentlich ein BiPro-Thema?"
Neuer Body: "Ist das eigentlich ein BiPro-Thema? Siehe DEMV-4127."
```

Mention-Extractor sieht das `record.updated`-Event, scannt den neuen Body, findet `DEMV-4127`. Edge wird emittiert. Materializer macht UPSERT mit UNIQUE-Constraint — wenn die Edge schon existieren würde (etwa weil der Body schon mal denselben Inhalt hatte), würde sie aktualisiert. Hier ist sie neu — wird einfach eingefügt.

Ältere Mention-Edges des Records (etwa zu einem im alten Body genannten anderen Issue) bleiben stehen, falls der Match aus dem alten Body wegfiel. Im Pilot akzeptiertes Verhalten — Mention-Edges sind additiv, kein Diff-Logic.

## Cross-Links

- Was im Stream ankommt: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Wer Records produziert: [Zettel 2 — Connectors](./02_connectors.md)
- Wo Mention-Edges materialisiert werden: [Zettel 3 — Materialisierer](./03_materialisierer.md)
- Konsumenten der Mention-Edges: [Zettel 6 — Tool-Layer](./06_tool_layer.md) (`get_neighbors`, `triage_topics`-Reasoning)
