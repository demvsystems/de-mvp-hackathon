# Zettel 8 — LLM-Bewerter

Bewertet jedes aktive Topic mit Charakter-Klasse (`attention`, `opportunity`, `noteworthy`, `calm`) und einem strukturierten Reasoning. Der LLM hat Zugriff auf den Tool-Layer, um eigenständig Kontext zu sammeln. Event-driven, getriggert von neuen Topic-Aktivitäten.

---

## Was

**Verantwortung.** Pro relevanter Topic-Aktivität eine Bewertung produzieren: Charakter-Klasse, Eskalations-Score, strukturiertes Reasoning mit Sentiment-Aggregat und Belegketten.

**Stack.**

- TypeScript/Node, ein Worker
- JetStream Durable Consumer mit Subject-Filter `events.edge.observed.topic-discovery` und `events.topic.activity.updated`
- Anthropic-API (oder vergleichbares LLM mit Tool-Use-Support)
- Zugriff auf den Tool-Layer (HTTP-Calls an `localhost:<port>/tools/*`)

**Was er schreibt.**

- `topic.assessment.created`-Event in den Stream
- Materializer schreibt es in `topic_assessments`-Tabelle

**Was er nicht tut.**

- Keine eigenen Schreibvorgänge in andere Tabellen
- Keine Tool-Mutations (er nutzt nur Read-Tools)
- Keine Bewertungen außerhalb des Stream-Triggers (im Pilot — auf-Demand-Mode kommt in Phase 2)

## Wie

### Charakter-Klassen

Vier Werte, die handlungsrelevante und unauffällige Topics gleichermaßen klassifizieren:

| Charakter     | Bedeutung                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `attention`   | Negative Eskalation, Aufmerksamkeit erforderlich. Frust eskaliert, technische Schulden brennen, Onboarding-Friction wird systematisch. |
| `opportunity` | Positive Resonanz, Chance erkannt, Aktion zur Verstärkung sinnvoll. Feature-Begeisterung, Markenbaustein-Potenzial.                    |
| `noteworthy`  | Relevant aber kein Handlungsdruck, sollte aber im Blick bleiben. Diskussion ohne Eskalation.                                           |
| `calm`        | Keine Auffälligkeit, Topic läuft normal.                                                                                               |

`triage_topics` filtert standardmäßig auf `attention` und `opportunity`. `noteworthy` und `calm` sind über expliziten Filter abrufbar — wichtig für Audit, Eval und das Tool-Layer-Versprechen, dass jedes aktive Topic eine Bewertung hat.

### Trigger-Logik

Der Worker läuft event-driven, aber nicht bei _jedem_ einzelnen Edge-Event — das wäre überspezifiziert und teuer. Stattdessen reagiert er auf Aggregat-Signale.

**Trigger 1: neue `discusses`-Edge.** Wenn ein Record einem Topic zugeordnet wird, wird das Topic in eine "pending re-assessment"-Liste aufgenommen. Die Liste wird gedebounced und alle 5 Minuten oder nach Schwellwert (etwa 5 neue Mitgliedschaften pro Topic) abgearbeitet.

**Trigger 2: `topic.activity.updated`-Event.** Der Topic-Activity-Worker emittiert dieses Event, wenn er Aktivitätsmetriken signifikant geändert hat (etwa Stagnations-Severity wechselt von `low` auf `high`). Solche Events lösen direkt eine Bewertung aus.

**Trigger 3: explizit angefordert.** Der Tool-Layer kann via Stream-Event `events.topic.assessment.requested` eine Bewertung anfordern (z.B. wenn `triage_topics` ein Topic ohne aktuelle Bewertung sieht). Der Bewerter reagiert auf dieses Subject und priorisiert solche Anfragen.

```typescript
const consumer = await js.consumers.get('EVENTS', 'llm-assessor');

const pendingReassessment = new Map<string, Date>(); // topic_id → first-pending-at

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type === 'edge.observed' && envelope.payload.type === 'discusses') {
      const topicId = envelope.payload.to_id;
      pendingReassessment.set(topicId, pendingReassessment.get(topicId) ?? new Date());
    }

    if (envelope.event_type === 'topic.activity.updated') {
      // Direkt bewerten, wenn signifikante Änderung
      if (isSignificantChange(envelope)) {
        await assessTopic(envelope.subject_id, 'activity_change');
      }
    }

    if (envelope.event_type === 'topic.assessment.requested') {
      await assessTopic(envelope.subject_id, 'tool_call');
    }

    msg.ack();
  } catch (err) {
    log.error('llm-assessor error', err);
    msg.nak();
  }
}

// Debounced batch — periodisch
setInterval(async () => {
  for (const [topicId, firstPending] of pendingReassessment) {
    if (Date.now() - firstPending.getTime() > 5 * 60 * 1000) {
      await assessTopic(topicId, 'scheduled');
      pendingReassessment.delete(topicId);
    }
  }
}, 60 * 1000);
```

### Was kommt in den Prompt — Default plus Tool-Use

Der Bewerter kombiniert vorab-aufbereiteten Kontext mit Tool-Use-Möglichkeiten.

**Pre-Loaded-Kontext (immer im Prompt).**

- Topic-Metadaten: Label, Status, Discovery-Datum, aktuelle Activity-Metriken
- Stagnations-Severity
- Top-N (initial 10) Topic-Mitglieder mit Title, Body-Snippet, Source, Author, Timestamps
- Bisherige Bewertungs-Historie der letzten 7 Tage

**Tool-Use-fähige Erweiterungen.** Der LLM bekommt Zugriff auf eine Auswahl der Tool-Layer-Endpoints und kann selbst entscheiden, welche zusätzlichen Kontexte er braucht:

- `get_record(id)` — Volltext eines Beleg-Records
- `get_neighbors(id, edge_types)` — Cross-Source-Mentions, Author, Container nachschlagen
- `get_thread(id)` — wenn ein Slack-Thread relevant scheint
- `get_topic_context(topic_id, depth: 'detailed')` — falls die Pre-Loaded-Mitglieder nicht reichen
- `find_similar(record_id)` — für semantisch verwandte Records außerhalb des Topics

Welche Tools genau exponiert werden, wird beim Bauen finalisiert. Pragmatischer Pilot-Default: oben genannte fünf, ohne Schreib-Tools.

### Topic-Mitglieder — was ist "Top-N"?

Die Auswahl der Top-N für den Pre-Loaded-Kontext ist eine offene Designfrage, im Bauen kalibriert. Vorschläge zur ersten Iteration:

- N = 10 als Default
- Mischung aus: jüngste 3, älteste 2, höchste Confidence 3, eine pro Quelle die noch nicht vertreten ist
- Falls Topic < 10 Mitglieder hat: alle nehmen
- Records, die vom Mention-Extractor als `mentions`-Quellen identifiziert wurden, bekommen Bonus-Priorität (sie sind wahrscheinlich Brücken zwischen Quellen)

Wenn das nicht reicht, kann der LLM via Tool-Use weitere Mitglieder oder Cross-Source-Verweise nachladen.

### Prompt-Struktur

```
Du bewertest ein Topic in einem Themen-/Eskalations-Erkennungssystem.

# Topic
ID: {topic_id}
Label: {topic_label}
Status: active
Entdeckt am: {discovered_at}
Discovery-Methode: {discovered_by}

## Aktivitätsmetriken
- Mitgliederzahl: {member_count} (über {source_count} Quellen)
- Aktivität letzte 24h: {velocity_24h} neue Mitglieder
- 7-Tage-Schnitt: {velocity_7d_avg} Mitglieder/Tag
- Trend: {activity_trend}
- Letzte Aktivität: {last_activity_at}

## Stagnations-Signal
- Severity: {stagnation_severity}
- Anzahl stagnierender Mitglieder: {stagnation_signal_count}

## Top-Mitglieder (10)
{für jeden Top-Member:}
  ### {idx}. {source} — {type} ({timestamp})
  Author: {author_display_name}
  Title: {title}
  Body: {body_snippet}
  Edge-Confidence: {discusses_confidence}
  ID: {record_id}

## Bisherige Bewertungen (letzte 7 Tage)
{liste:}
  - {assessed_at}: {character} (Score {escalation_score}) — {brief_reasoning}

# Aufgabe

Klassifiziere dieses Topic in eine der vier Kategorien:
- `attention` — negative Eskalation, Aufmerksamkeit erforderlich
- `opportunity` — positive Resonanz, Chance erkannt
- `noteworthy` — relevant aber kein Handlungsdruck
- `calm` — unauffällig

Gib einen Eskalations-Score zwischen 0 und 1 (je höher desto handlungsdringlicher) und ein
strukturiertes Reasoning. Das Reasoning soll enthalten:
- sentiment_aggregate: textuelle Zusammenfassung der Stimmung
- key_signals: Liste der 3-5 wichtigsten Beobachtungen
- key_artifacts: IDs der wichtigsten Belege

Bei Bedarf kannst du folgende Tools verwenden, um zusätzlichen Kontext zu sammeln:
- get_record(id)
- get_neighbors(id, edge_types)
- get_thread(id)
- get_topic_context(topic_id)
- find_similar(record_id)

Antworte abschließend im JSON-Format gemäß der Schema-Definition.
```

### Output-Schema (Zod)

```typescript
const AssessmentOutput = z.object({
  character: z.enum(['attention', 'opportunity', 'noteworthy', 'calm']),
  escalation_score: z.number().min(0).max(1),
  reasoning: z.object({
    sentiment_aggregate: z.string(),
    key_signals: z.array(z.string()).min(1).max(7),
    key_artifacts: z.array(z.string()).min(0), // Record-IDs als Belege
    additional_notes: z.string().optional(),
  }),
});
```

Der LLM bekommt das Schema mitgeliefert. Die Antwort wird gegen Zod validiert; bei Schema-Verletzungen wird das LLM einmal mit Fehlermeldung re-prompted, dann fällt der Worker zurück auf eine Default-Bewertung mit `character: 'noteworthy'` und `escalation_score: 0.5` plus `additional_notes: 'auto-fallback: schema validation failed'`.

### Tool-Use-Loop

Wenn der LLM Tools nutzen will, läuft eine Multi-Turn-Konversation:

```typescript
async function assessTopic(topicId: string, trigger: string) {
  const initialPrompt = await buildInitialPrompt(topicId);

  const messages = [{ role: 'user', content: initialPrompt }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: AVAILABLE_TOOLS,
      messages,
    });

    if (response.stop_reason === 'tool_use') {
      const toolResults = await Promise.all(
        response.content
          .filter((c) => c.type === 'tool_use')
          .map(async (tc) => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: await callToolLayer(tc.name, tc.input),
          })),
      );

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'end_turn') {
      const jsonOutput = extractJSON(response.content);
      const parsed = AssessmentOutput.safeParse(jsonOutput);

      if (parsed.success) {
        return parsed.data;
      } else {
        // Re-prompt mit Validation-Fehler
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: `Schema validation failed: ${parsed.error.message}. Bitte korrigiere und antworte nochmal nur mit dem JSON.`,
        });
        continue;
      }
    }
  }

  // Fallback nach MAX_TURNS
  return defaultFallbackAssessment();
}

const MAX_TURNS = 6;
```

Max 6 Turns als Sicherung gegen unbegrenzte Tool-Use-Loops. In der Praxis sollten 2–3 Turns reichen — der LLM lädt 1–2 zusätzliche Records und produziert dann das Reasoning.

### Tool-Calls validiert

Tool-Calls vom LLM werden gegen die Tool-Layer-Schemas validiert, bevor sie ausgeführt werden:

```typescript
async function callToolLayer(toolName: string, input: unknown): Promise<string> {
  const validators: Record<string, ZodSchema> = {
    get_record: GetRecordRequest,
    get_neighbors: GetNeighborsRequest,
    get_thread: GetThreadRequest,
    get_topic_context: GetTopicContextRequest,
    find_similar: FindSimilarRequest,
  };

  const validator = validators[toolName];
  if (!validator) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  const parsed = validator.safeParse(input);
  if (!parsed.success) {
    return JSON.stringify({ error: `Invalid input: ${parsed.error.message}` });
  }

  const response = await fetch(`http://localhost:3000/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });

  return await response.text();
}
```

Damit kann ein fehlerhafter Tool-Call den Worker nicht in den Tool-Layer crashen — der LLM bekommt einen strukturierten Fehler zurück und kann es nochmal versuchen.

### Assessment-Event emittieren

Nach erfolgreicher Bewertung:

```typescript
await publishEvent({
  event_type: 'topic.assessment.created',
  subject_kind: 'assessment',
  subject_id: `assessment:${topicId}:llm:claude:v1:${new Date().toISOString()}`,
  source: 'llm-assessor:v1',
  occurred_at: new Date().toISOString(),
  payload: {
    topic_id: topicId,
    assessor: 'llm:claude:v1',
    assessed_at: new Date().toISOString(),
    character: result.character,
    escalation_score: result.escalation_score,
    reasoning: result.reasoning,
    triggered_by: trigger,
  },
  correlation_id: topicId,
});
```

Materializer schreibt es in `topic_assessments`. Append-only — die Bewertungs-Historie wächst, alte Bewertungen werden nie überschrieben.

### Idempotenz und Re-Bewertung

Bewertungen sind nicht idempotent — derselbe Trigger kann verschiedene Bewertungen produzieren, weil der LLM stochastisch ist. Im Pilot akzeptieren wir das. Multiple Bewertungen pro Topic in derselben Stunde bedeuten, dass `triage_topics` (das die jüngste pro Topic nimmt) die letzte sieht.

Zur Eval-Reproduzierbarkeit gibt es einen "deterministic mode": Temperature 0, fixierter Seed, falls vom LLM-Provider unterstützt. Im Pilot ist das die Default-Konfiguration für scheduled-Runs; bei tool-call-getriggerten Bewertungen kann höhere Temperature für vielfältigere Begründungen sinnvoll sein.

### Cost-Considerations

Im Pilot mit z.B. 50 aktiven Topics und 5-Minuten-Debounce: maximal 50 Bewertungen pro 5 Minuten = 600 pro Stunde Burst-Last. In der Praxis viel weniger, weil nicht alle Topics gleichzeitig pending werden.

Pro Bewertung typisch 2-3 Tool-Calls plus finaler Output. Mit Claude Sonnet 4.6 schätzungsweise 5-15 Cent pro Bewertung. Im Pilot total überschaubar; bei Skalierung in Produktion wird Pre-Classifier oder gestufte Bewertung relevanter (Phase 2).

### Eval-Hooks

Das `events.topic.assessment.created`-Event ist der zentrale Eval-Datenpunkt. Goldstandard-Topics werden mit erwarteten Charakter-Klassen ausgestattet; das Eval-Framework vergleicht erwartete vs. tatsächliche Klassifikation:

```sql
-- Beispiel-Query: Eval-Accuracy pro Charakter
SELECT
  expected_character,
  COUNT(*) FILTER (WHERE actual_character = expected_character) AS correct,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE actual_character = expected_character)::float / COUNT(*) AS accuracy
FROM eval_run_topics e
JOIN topic_assessments_recent a ON a.topic_id = e.topic_id
WHERE e.eval_run_id = $1
GROUP BY expected_character;
```

## Warum

**Warum event-driven, nicht periodisch?** Bei rein periodischer Bewertung (z.B. täglich) wäre ein Topic, das innerhalb des Tages eskaliert, möglicherweise erst am nächsten Tag korrekt klassifiziert. Eskalations-Erkennung muss zeitnah sein. Event-driven mit Debounce ist der Kompromiss zwischen Reaktionsschnelligkeit und Cost-Effizienz.

**Warum Tool-Use statt Pre-Loaded-Volltext?** Pre-Loaded-Volltext heißt, der Prompt enthält _alles_, was relevant sein könnte. Bei Topics mit 50+ Mitgliedern und Cross-Source-Verflechtungen explodiert das Prompt-Token-Budget. Mit Tool-Use kann der LLM gezielt nachladen, was er für die konkrete Bewertung braucht — minimale Tokens, mehr Kontextqualität. Trade-off: zusätzliche Latenz pro Tool-Call (~50-200ms), aber das ist akzeptabel.

**Warum vier Charakter-Klassen, nicht nur zwei?** Wenn der Bewerter nur `attention` und `opportunity` schreibt, gibt es im Eval keine True-Negatives — wir wissen nicht, ob "calm"-Topics korrekt nicht-eskaliert wurden. Mit vier Klassen ist jedes aktive Topic klassifiziert, "calm" ist eine bewusste Aussage. Das macht Audit, Debug und Eval sauberer. Nachteil: höhere Cost-Linearität, aber Pilot-pragmatisch akzeptabel.

**Warum Re-Bewertung statt einmaliger Bewertung?** Topics ändern ihren Charakter. Ein Topic, das gestern `noteworthy` war, kann heute `attention` werden, weil neue eskalierende Belege dazukamen. Bewertungs-Historie zeigt den Verlauf — `escalation_score` über Zeit ist ein guter Indikator dafür, _wie schnell_ etwas eskaliert.

**Warum nicht nur on-demand bei `triage_topics`?** On-demand wäre günstiger (kein Bewertungs-Backlog), aber `triage_topics` würde dann pro Aufruf neu bewerten — Latenz von 10+ Sekunden pro Tool-Call wegen LLM-Round-Trip. Mit periodisch/event-driven sind Bewertungen vorberechnet, `triage_topics` ist instant.

**Warum strukturiertes Reasoning statt Freitext?** Der Reasoning-Output ist nicht nur für Menschen, sondern auch für Eval. Strukturierte Felder (`sentiment_aggregate`, `key_signals`, `key_artifacts`) lassen sich automatisch gegen Goldstandards prüfen. Freitext wäre interpretations-bedürftig. Trade-off: weniger Ausdrucksvielfalt, aber im Pilot wertvoll für reproduzierbare Eval.

**Warum Tool-Layer-Zugriff statt direkten DB-Zugriff?** Der Tool-Layer ist die kanonische Read-Schnittstelle mit Aliasing, Determinismus, Provenance. Wenn der Bewerter direkt auf die DB zugreift, müsste er die ganze Layer-Logik duplizieren. Indem er den Tool-Layer nutzt, profitiert er automatisch von zukünftigen Verbesserungen (etwa neuen Tools, besseren Recency-Modellen).

**Warum Schema-validiertes Output?** Ohne Schema-Validierung müsste der Materializer mit beliebigen Reasoning-Strukturen klarkommen. Mit Schema kann der Pilot davon ausgehen, dass `key_signals` immer ein Array ist und `escalation_score` immer ein 0–1-Wert. Das vereinfacht den Tool-Layer-Code für `triage_topics` und macht Eval-Queries möglich. Bei Validation-Fehler: re-prompt einmal, dann Fallback — pragmatischer Schutz gegen LLM-Halluzinationen ohne Crash.

**Warum Multi-Source-Pattern auch hier (assessor-Tag)?** Wenn später ein zweiter Bewerter dazukommt (etwa heuristisch oder embedding-anomaly-basiert), leben beide parallel als getrennte Einträge. `triage_topics` kann dann Konsens-Aussagen machen ("attention nach beiden Bewertern"). Im Pilot mit nur LLM-Bewerter unsichtbar, aber Schema-Vorbereitung für Phase 2.

## Beispiele

### Beispiel 1: Pre-Loaded-Prompt für ein BiPro-Topic

Wenn der Bewerter wegen 3 neuer `discusses`-Edges auf das BiPro-Topic getriggert wird, wird folgender Prompt gebaut:

```
Du bewertest ein Topic in einem Themen-/Eskalations-Erkennungssystem.

# Topic
ID: topic:7c8d9e1f-2a3b-4c5d-6e7f-8a9b0c1d2e3f
Label: BiPro 430.4 / Concordia-Bestandsverlust
Status: active
Entdeckt am: 2026-04-13T14:22:11Z
Discovery-Methode: topic-discovery:body-only:v1

## Aktivitätsmetriken
- Mitgliederzahl: 12 (über 4 Quellen)
- Aktivität letzte 24h: 3 neue Mitglieder
- 7-Tage-Schnitt: 1.4 Mitglieder/Tag
- Trend: growing
- Letzte Aktivität: 2026-04-15T10:42:33Z

## Stagnations-Signal
- Severity: low
- Anzahl stagnierender Mitglieder: 2

## Top-Mitglieder (10)

### 1. slack — message (2026-04-15T10:42:33Z)
Author: Bob Schmidt
Title: null
Body: Stimmt — und der gleiche Einwand kam letzte Woche schon. Ist das DEMV-4127?
Edge-Confidence: 0.88
ID: slack:msg:T01ABC/C02DEF/1714028591.012345

### 2. slack — message (2026-04-14T09:15:00Z)
Author: Carla Weber
Title: null
Body: Bei mir auch wieder. POOL_EXTERN_01 schluckt erneut die Sparte. Wird das jetzt mal angefasst?
...

### 3. jira — issue (2025-11-12T08:30:00Z)
Author: Carla Weber
Title: BiPro Norm 430.4 – Concordia-Anbindung nachziehen
Body: Concordia liefert GDV-Daten ausschließlich über Norm 430.4. Unsere aktuelle Schnittstelle...
ID: jira:issue:10042
...

(weitere Mitglieder)

## Bisherige Bewertungen (letzte 7 Tage)
- 2026-04-14T02:00:00Z: attention (Score 0.72) — Verstärkt frustriert, vier Quellen
- 2026-04-13T02:00:00Z: attention (Score 0.65) — Frustration sichtbar, Eskalations-Trend

# Aufgabe
...
```

### Beispiel 2: LLM nutzt Tools

Der LLM antwortet:

```
Ich sehe in den Top-Mitgliedern Verweise auf das Jira-Ticket DEMV-4127. Ich möchte
prüfen, ob dieses Ticket priorisiert wurde und welche Verbindungen es hat.
```

Tool-Call: `get_record(jira:issue:10042)`. Ergebnis:

```json
{
  "id": "jira:issue:10042",
  "type": "issue",
  "title": "BiPro Norm 430.4 – Concordia-Anbindung nachziehen",
  "metadata": {
    "payload": {
      "key": "DEMV-4127",
      "priority": "Low",
      "status": "Backlog",
      "assignee_id": null
    }
  }
}
```

Tool-Call: `get_neighbors(jira:issue:10042, edge_types: ['mentions'])`. Ergebnis: 5 Records aus Slack und Intercom, die das Ticket erwähnen.

Daraufhin produziert der LLM:

```json
{
  "character": "attention",
  "escalation_score": 0.84,
  "reasoning": {
    "sentiment_aggregate": "verstärkt frustriert mit eskalations-Trend; mehrere Makler thematisieren das Bestandsverlust-Problem direkt oder via DEMV-4127",
    "key_signals": [
      "drei neue Slack-Threads in 24h, alle mit Bestandsverlust-Bezug",
      "Jira-Ticket DEMV-4127 hat 5 Cross-Source-Mentions, ist aber unzugewiesen und auf Low-Priority",
      "Stagnations-Signal: zwei Threads ohne Antwort seit 4 Tagen (Eskalation aus Stille)",
      "WON_DEAL_005 erwähnt Topic explizit als Risiko",
      "Trend wachsend; 7-Tage-Velocity verdoppelt"
    ],
    "key_artifacts": [
      "slack:msg:T01ABC/C02DEF/1714028591.012345",
      "jira:issue:10042",
      "intercom:thread:abc123"
    ],
    "additional_notes": "Lücke zwischen Jira-Priorität (Low) und Belegdichte (12 Mitglieder, 4 Quellen) ist signifikant. Empfehlung an Konsumenten: Re-Priorisierung des Tickets und Cross-Channel-Kommunikation an betroffene Makler."
  }
}
```

### Beispiel 3: Resultierender Tabellen-Eintrag

Nach Materializer-Verarbeitung:

```
topic_id                                      | assessor      | assessed_at             | character | escalation_score | reasoning (JSONB-Auszug)                                                                                                                          | triggered_by
──────────────────────────────────────────────┼───────────────┼─────────────────────────┼───────────┼──────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────
topic:7c8d9e1f-2a3b-...                       | llm:claude:v1 | 2026-04-15T11:08:14Z    | attention | 0.84             | {"sentiment_aggregate":"verstärkt frustriert...","key_signals":["drei neue Slack-Threads...","Jira-Ticket DEMV-4127 hat 5 Cross-Source-Mentions"...]} | scheduled
```

`triage_topics` mit Default-Filter (`attention`, `opportunity`) liefert dieses Topic als ersten Eintrag, weil Score 0.84 hoch ist.

### Beispiel 4: Calm-Topic-Bewertung

Bei einem unauffälligen Topic — etwa wenige Mitglieder, neutrale Diskussion, kein Eskalations-Indikator — produziert der LLM:

```json
{
  "character": "calm",
  "escalation_score": 0.12,
  "reasoning": {
    "sentiment_aggregate": "neutrale Diskussion, kein Handlungsdruck",
    "key_signals": [
      "nur 3 Mitglieder, alle aus Slack",
      "letzte Aktivität vor 12 Tagen",
      "kein Stagnations-Signal, kein Cross-Source-Spread",
      "Diskussion endete mit Konsens"
    ],
    "key_artifacts": ["slack:msg:T01ABC/C03GHI/1713456000.001"],
    "additional_notes": null
  }
}
```

Auch das landet in `topic_assessments`. Im `triage_topics`-Default unsichtbar, aber im Audit-Modus (`character: ['calm']`) abrufbar.

## Cross-Links

- Was im Stream ankommt: [Zettel 1 — Eventsystem](./01_eventsystem.md)
- Trigger-Quellen: [Zettel 5 — Clustering](./05_clustering.md) (für `discusses`-Edges) und Topic-Activity-Worker (im Pilot-Plan, nicht eigener Zettel)
- Tools, die der LLM nutzen kann: [Zettel 6 — Tool-Layer](./06_tool_layer.md)
- Wo Bewertungen gelesen werden: [Zettel 6 — Tool-Layer](./06_tool_layer.md) (`triage_topics`)
- Wo Bewertungen materialisiert werden: [Zettel 3 — Materialisierer](./03_materialisierer.md)
