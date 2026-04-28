# Zettel 9 — Topic-Activity-Worker

Pflegt die Aktivitäts- und Stagnations-Metriken am Topic. Reagiert auf jede neue `discusses`-Edge und recomputet die betroffenen Felder. Ergänzt durch einen periodischen Decay-Worker, der zeitabhängige Werte aktuell hält.

---

## Was

**Verantwortung.** Pro Topic die Aktivitätsmetriken (`velocity_24h`, `velocity_7d_avg`, `spread_24h`, `unique_authors_7d`, `member_count`, `source_count`, `first_activity_at`, `last_activity_at`, `activity_trend`, `computed_at`) und Stagnations-Felder (`stagnation_signal_count`, `stagnation_severity`) berechnen und in der `topics`-Tabelle aktualisieren.

**Stack.**

- TypeScript/Node, ein Worker
- JetStream Durable Consumer mit Subject-Filter `events.edge.observed.topic-discovery`
- Zusätzlich periodisches Sub-Modul (Decay-Worker) für zeitabhängige Aktualisierung
- Postgres-Pool für Read und Write

**Was er schreibt.**

- Direktes Update an `topics`-Tabelle (Aktivitätsfelder und Stagnations-Felder)
- Optional: `events.topic.activity.updated`-Event in den Stream, wenn signifikante Änderung — der LLM-Bewerter hört darauf

**Was er nicht tut.**

- Keine eigenen Topic-Mitgliedschafts-Entscheidungen (das macht der Topic-Worker)
- Keine Bewertungen (das macht der LLM-Bewerter)
- Keine Records oder Edges schreiben

## Wie

### Trigger und Reaktion

Pro neuem `discusses`-Event reagiert der Worker _sofort_ — kein Debouncing. Begründung: bei moderater Pilot-Last sind das wenige Events pro Minute, und die SQL-Aggregation ist schnell. Wenn später Burst-Last entsteht, kann Coalescing nachgerüstet werden.

```typescript
const consumer = await js.consumers.get('EVENTS', 'topic-activity');

for await (const msg of await consumer.consume()) {
  try {
    const envelope = EventEnvelope.parse(JSON.parse(msg.string()));

    if (envelope.event_type === 'edge.observed' && envelope.payload.type === 'discusses') {
      const topicId = envelope.payload.to_id;
      await recomputeTopic(topicId);
    }

    msg.ack();
  } catch (err) {
    log.error('topic-activity error', err);
    msg.nak();
  }
}
```

### Pro Topic-Recompute — ein SQL-Block

Aktivitätsmetriken werden in _einer_ aggregierten Query berechnet, dann mit einem UPDATE gespeichert.

```sql
WITH topic_members AS (
  SELECT
    e.from_id AS record_id,
    r.created_at AS record_time,
    r.source AS record_source,
    -- Author über strukturelle Edge bestimmen
    (SELECT to_id FROM edges
     WHERE from_id = e.from_id AND type = 'authored_by' AND valid_to IS NULL
     LIMIT 1) AS author_id
  FROM edges e
  JOIN records r ON r.id = e.from_id AND r.is_deleted = false
  WHERE e.to_id = $1            -- topic_id
    AND e.type = 'discusses'
    AND e.valid_to IS NULL
)
SELECT
  COUNT(*)                                   AS member_count,
  COUNT(DISTINCT record_source)              AS source_count,
  COUNT(DISTINCT author_id) FILTER (
    WHERE record_time >= now() - interval '7 days'
  )                                          AS unique_authors_7d,
  MIN(record_time)                           AS first_activity_at,
  MAX(record_time)                           AS last_activity_at,
  COUNT(*) FILTER (
    WHERE record_time >= now() - interval '24 hours'
  )                                          AS velocity_24h,
  COUNT(*) FILTER (
    WHERE record_time >= now() - interval '7 days'
  )::float / 7.0                             AS velocity_7d_avg,
  COUNT(DISTINCT record_source) FILTER (
    WHERE record_time >= now() - interval '24 hours'
  )                                          AS spread_24h
FROM topic_members;
```

Die Aggregation läuft komplett in Postgres — keine In-Memory-Sammlungen, keine N+1-Patterns. Bei 50 Mitgliedern pro Topic typisch < 5ms.

`record_time` ist `records.created_at` (Quell-Zeit), nicht `edges.observed_at`. Begründung: die Frage "wie aktiv ist das Topic" bezieht sich auf die _Diskurs-Aktivität in den Quellen_, nicht auf die Verarbeitungs-Zeit im System. Wenn ein Backfill alte Slack-Messages ingestiert, sollen die nicht als "frische Aktivität" zählen.

### Activity-Trend ableiten

Aus den numerischen Werten wird der `activity_trend` als Kategorie gesetzt:

```typescript
function deriveActivityTrend(
  velocity24h: number,
  velocity7dAvg: number,
  lastActivity: Date,
): ActivityTrend {
  const daysSinceLastActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceLastActivity > 7) return 'dormant';
  if (velocity7dAvg < 0.5) return 'stable'; // zu wenig Aktivität für trend-Aussage
  if (velocity24h > velocity7dAvg * 1.5) return 'growing';
  if (velocity24h < velocity7dAvg * 0.5) return 'declining';
  return 'stable';
}
```

Die Schwellwerte (1.5×, 0.5×, 7-Tage-Dormancy) sind Pilot-Werte und werden im Bauen kalibriert.

### Stagnations-Berechnung — direkt im selben Pass

Pro Topic-Mitglied wird geprüft, ob es ein "stagnierendes Muster" zeigt:

- Slack-Thread (Top-Level mit Replies-Möglichkeit, ohne Reply seit X Tagen)
- GitHub-Issue oder PR ohne Comment seit X Tagen
- Jira-Issue ohne Comment oder Status-Change seit X Tagen
- Confluence-Page mit Comment, dessen letzter Reply ausbleibt seit X Tagen

Im Pilot pragmatisch eine _einheitliche_ Schwelle: 5 Tage seit letzter Folge-Aktivität. Pro Record-Typ unterschiedliche Schwellen sind eine Phase-2-Verfeinerung.

```sql
WITH topic_members AS (
  -- wie oben
),
member_stagnation AS (
  SELECT
    tm.record_id,
    tm.record_time,
    -- Letzte Folge-Aktivität: irgendeine Edge oder ein Comment, der diesen Record als Ziel hat
    GREATEST(
      tm.record_time,
      COALESCE((
        SELECT MAX(r2.created_at)
        FROM edges e2
        JOIN records r2 ON r2.id = e2.from_id AND r2.is_deleted = false
        WHERE e2.to_id = tm.record_id
          AND e2.type IN ('replies_to', 'commented_on')
          AND e2.valid_to IS NULL
      ), tm.record_time)
    ) AS last_followup_at
  FROM topic_members tm
)
SELECT
  COUNT(*) FILTER (
    WHERE last_followup_at < now() - interval '5 days'
      AND record_time < now() - interval '5 days'
  ) AS stagnation_signal_count
FROM member_stagnation;
```

Stagnations-Severity:

- `none` wenn weniger als 20% der Mitglieder stagnieren
- `low` zwischen 20% und 50%
- `high` über 50%

```typescript
function deriveStagnationSeverity(stagnationCount: number, totalCount: number): StagnationSeverity {
  if (totalCount === 0) return 'none';
  const ratio = stagnationCount / totalCount;
  if (ratio >= 0.5) return 'high';
  if (ratio >= 0.2) return 'low';
  return 'none';
}
```

### Recompute in einer Transaction

Alle berechneten Felder werden in einem einzigen UPDATE gespeichert:

```typescript
async function recomputeTopic(topicId: string) {
  await db.transaction(async (tx) => {
    const metrics = await computeActivityMetrics(tx, topicId);
    const stagnation = await computeStagnation(tx, topicId, metrics.member_count);

    const trend = deriveActivityTrend(
      metrics.velocity_24h,
      metrics.velocity_7d_avg,
      metrics.last_activity_at,
    );

    const previousSnapshot = await loadCurrentSnapshot(tx, topicId);

    await tx.query(
      `
      UPDATE topics
      SET member_count            = $1,
          source_count            = $2,
          unique_authors_7d       = $3,
          first_activity_at       = $4,
          last_activity_at        = $5,
          velocity_24h            = $6,
          velocity_7d_avg         = $7,
          spread_24h              = $8,
          activity_trend          = $9,
          stagnation_signal_count = $10,
          stagnation_severity     = $11,
          computed_at             = now()
      WHERE id = $12
    `,
      [
        metrics.member_count,
        metrics.source_count,
        metrics.unique_authors_7d,
        metrics.first_activity_at,
        metrics.last_activity_at,
        metrics.velocity_24h,
        metrics.velocity_7d_avg,
        metrics.spread_24h,
        trend,
        stagnation.stagnation_signal_count,
        stagnation.stagnation_severity,
        topicId,
      ],
    );

    // Optional: Activity-Updated-Event emittieren bei signifikanter Änderung
    if (isSignificantChange(previousSnapshot, { ...metrics, trend, ...stagnation })) {
      await publishActivityUpdatedEvent(topicId, trend, stagnation);
    }
  });
}
```

### Was zählt als "signifikante Änderung"?

Im Pilot pragmatisch: das Event wird emittiert, wenn

- der `activity_trend` sich ändert (z.B. `stable` → `growing`)
- die `stagnation_severity` sich ändert (z.B. `low` → `high`)
- `velocity_24h` sich gegenüber dem letzten Snapshot mehr als verdoppelt oder halbiert

Bei reinen Inkrement-Updates (ein neuer Member, sonst alles gleich) wird kein Event emittiert. Damit wird der LLM-Bewerter nur bei tatsächlich relevanten Änderungen geweckt, nicht bei jedem Edge.

```typescript
function isSignificantChange(prev: TopicSnapshot | null, next: TopicSnapshot): boolean {
  if (!prev) return true;

  if (prev.activity_trend !== next.activity_trend) return true;
  if (prev.stagnation_severity !== next.stagnation_severity) return true;

  if (next.velocity_24h > prev.velocity_24h * 2) return true;
  if (next.velocity_24h < prev.velocity_24h * 0.5 && next.velocity_24h < prev.velocity_24h - 2)
    return true;

  return false;
}
```

### Activity-Updated-Event-Format

```json
{
  "event_type": "topic.activity.updated",
  "subject_kind": "topic",
  "subject_id": "topic:7c8d9e1f-2a3b-...",
  "source": "topic-activity:v1",
  "occurred_at": "2026-04-15T10:42:35.000Z",
  "payload": {
    "topic_id": "topic:7c8d9e1f-2a3b-...",
    "trend": "growing",
    "stagnation_severity": "low",
    "velocity_24h": 3,
    "velocity_7d_avg": 1.4,
    "change_summary": "trend changed: stable → growing; velocity_24h: 1 → 3"
  },
  "correlation_id": "topic:7c8d9e1f-2a3b-..."
}
```

Der Materializer ignoriert dieses Event (es ist kein struktureller Update). Der LLM-Bewerter und potenziell das Operations-Dashboard reagieren darauf.

### Decay-Worker — periodisch ergänzen

Reine Event-getriebene Aktualisierung hat ein subtiles Problem: zeitabhängige Werte (`velocity_7d_avg`, `activity_trend`) ändern sich, _auch wenn keine neuen Events kommen_. Ein Topic mit hoher Aktivität in Woche 1 und null in Woche 2 würde bei rein event-getriebener Aktualisierung als "growing" gelten, obwohl es eigentlich "declining" oder "dormant" ist.

Lösung: ein periodisches Sub-Modul, das alle Topics findet, deren `computed_at` älter als ein Schwellwert ist, und deren Metriken neu berechnet:

```typescript
async function decayPass() {
  const stale = await db.query(`
    SELECT id FROM topics
    WHERE status = 'active'
      AND (computed_at IS NULL OR computed_at < now() - interval '2 hours')
    ORDER BY computed_at NULLS FIRST
    LIMIT 100
  `);

  for (const { id } of stale) {
    await recomputeTopic(id);
  }
}

setInterval(decayPass, 5 * 60 * 1000); // alle 5 Minuten
```

Aktive Topics werden so spätestens alle 2 Stunden recomputed, auch wenn keine neuen `discusses`-Edges kommen. Dormant Topics seltener (siehe Optimierung unten).

### Optimierungs-Pfad: nicht alle Topics gleich häufig

Aktive Topics (jüngste Aktivität < 24h) sollen schnell aktuelle Metriken haben. Dormant Topics (letzte Aktivität > 7d) brauchen seltener Recompute. Pragmatisches Staffeln:

```typescript
async function smartDecayPass() {
  // Hot: < 24h aktiv → alle 30 Minuten
  await recomputeAged('1 hour', "last_activity_at >= now() - interval '24 hours'");

  // Warm: 1d-7d → alle 4 Stunden
  await recomputeAged(
    '4 hours',
    "last_activity_at >= now() - interval '7 days' AND last_activity_at < now() - interval '24 hours'",
  );

  // Cold/dormant: > 7d → einmal pro Tag
  await recomputeAged('24 hours', "last_activity_at < now() - interval '7 days'");
}
```

Im Pilot reicht der naive 2-Stunden-Decay, das Staffeln ist Phase-2-Optimierung wenn nötig.

### Race-Conditions

Wenn zwei `discusses`-Events für dasselbe Topic in Quasi-Parallelität ankommen (etwa beide aus Burst-Ingest derselben Slack-Diskussion), könnten zwei Recompute-Vorgänge gleichzeitig laufen. Mit Postgres-Row-Lock auf das Topic gibt es eine saubere Serialisierung:

```typescript
async function recomputeTopic(topicId: string) {
  await db.transaction(async (tx) => {
    await tx.query(`SELECT 1 FROM topics WHERE id = $1 FOR UPDATE`, [topicId]);
    // ... weiter wie oben
  });
}
```

Der Lock ist günstig (eine Zeile, kurz gehalten) und verhindert verlorene Updates bei parallelem Recompute.

### Fehlerverhalten

Wenn eine Aggregations-Query fehlschlägt (Postgres-Connection-Issue, Lock-Timeout): NAK auf das auslösende Event. JetStream redelivered nach Backoff. Der Worker fällt nicht aus, das Topic bleibt mit veralteten Metriken — beim nächsten Decay-Pass kommt es wieder dran.

Wenn ein Topic beim Recompute _nicht gefunden_ wird (etwa weil es zwischen Event-Emit und Recompute archiviert wurde): Skip ohne Fehler, ACK.

## Warum

**Warum sofort statt Debounce?** Bei moderater Pilot-Last sind `discusses`-Events nicht so häufig, dass Debouncing wirklich nötig wäre. Sofortiges Recompute hält die Aktivitätsmetriken so frisch wie möglich, was dem LLM-Bewerter und `triage_topics` zugute kommt. Wenn später hohe Last entsteht (mehrere Events pro Sekunde pro Topic), kann Debounce additiv eingebaut werden — es ändert nichts am Schema oder an der Output-Semantik, nur an der Trigger-Frequenz.

**Warum `records.created_at` als Zeit-Basis?** Die Aktivitätsmetriken sollen die Diskurs-Aktivität in den Quellen widerspiegeln, nicht die System-Verarbeitungs-Zeit. Bei Backfill alter Daten (etwa wenn ein neuer Connector dazukommt und Historisches einspielt) würde `observed_at` fälschlich "frische Aktivität" anzeigen, obwohl die Diskussion lange vorbei ist. `created_at` ist robust gegen solche Verzerrungen.

**Warum Recompute statt Inkrement?** Inkrement (etwa `member_count = member_count + 1`) wäre billiger pro Event, aber sehr fehleranfällig — bei verlorenen Events wird der Counter falsch und kann nicht mehr korrigiert werden, ohne kompletten Rebuild. Recompute aus den Edges ist immer korrekt und macht den Worker idempotent. Bei den Pilot-Größenordnungen (50–500 Mitglieder pro Topic) ist die Aggregations-Query schnell genug.

**Warum Decay-Worker zusätzlich?** Zeitabhängige Metriken (`velocity_7d_avg`, `activity_trend`, Stagnations-Severity) ändern sich mit der Zeit, auch ohne neue Events. Ein Topic, das vor zwei Wochen viele Mitglieder hatte und seitdem ruhig ist, sollte als `declining` oder `dormant` zeigen — ohne Decay würde es ewig auf `growing` stehen, weil das letzte Event seinen Snapshot dort eingefroren hat.

**Warum Activity-Updated-Event nur bei signifikanter Änderung?** Der LLM-Bewerter ist teurer als ein DB-Recompute. Wenn er bei _jedem_ Edge geweckt würde, würde der Pilot in LLM-Cost ertrinken. Mit signifikanter-Änderungs-Schwelle wird der Bewerter nur dann aktiv, wenn das Topic wirklich anders aussieht. Bei reinen Inkrement-Updates läuft der Bewerter ohnehin im periodischen Bewerter-Modus mit Debounce.

**Warum direkt in `topics`-Tabelle, kein Materializer-Umweg?** Aktivitätsmetriken sind reine Aggregate aus existierenden Edges, keine Streaming-State-Updates. Wenn der Materializer sie schreiben müsste, bräuchte er für jeden discusses-Edge einen Aggregations-Schritt — aufwändig und doppelt zur Worker-Logik. Direktes Update vom Activity-Worker ist sauber, weil dieser Worker die einzige Schreibquelle für diese Felder ist.

**Warum eine globale Stagnations-Schwelle statt pro Record-Typ?** Pilot-Pragmatik. Slack, Issues, Comments haben unterschiedliche Reaktionszeiten in der Realität, aber im Pilot sind die synthetischen Daten ohnehin nicht repräsentativ genug, um pro-Typ-Schwellen sinnvoll zu kalibrieren. Eine globale Schwelle macht den Code einfach, und wenn Eval zeigt dass es ein Problem ist, kommen pro-Typ-Schwellen in Phase 2 dazu — additive Erweiterung am bestehenden Code.

**Warum Stagnations-Severity in 3 Klassen statt Zahl?** Der LLM-Bewerter konsumiert Stagnations-Severity als Signal. Eine kategorische Klassifikation ist im Prompt einfacher zu interpretieren als eine numerische Ratio — `severity: high` triggert klares Verhalten, `0.6` muss gegen Erfahrungswerte abgewogen werden. Drei Klassen reichen für die Differenzierung, mehr wäre Pseudo-Präzision.

**Warum keine Cross-Topic-Stagnation?** Die Pilot-Stagnation sieht nur _innerhalb_ eines Topics — Mitglieder ohne Folge-Aktivität. Was sie nicht sieht: Personen, die ein Topic anfingen und dann verschwanden, ohne überhaupt einen Folge-Thread zu öffnen ("stiller Schwund"). Letzteres ist die Phase-2-Erweiterung mit dediziertem Cross-Topic-Stagnations-Worker, der über Topics hinaus auf User-Lebenszyklen schaut. Im Pilot bleibt das ausgeklammert.

## Beispiele

### Beispiel 1: BiPro-Topic recompute nach neuer Slack-Message

Vor dem Recompute (in `topics`-Tabelle):

```
id                          | member_count | velocity_24h | velocity_7d_avg | activity_trend | stagnation_severity | computed_at
────────────────────────────┼──────────────┼──────────────┼─────────────────┼────────────────┼─────────────────────┼─────────────────────────
topic:7c8d9e1f-2a3b-...      | 11           | 2            | 1.3             | stable         | low                 | 2026-04-15 09:00:00+00
```

Neue `discusses`-Edge kommt rein für eine Slack-Message von heute. Worker triggert `recomputeTopic('topic:7c8d9e1f-...')`.

Aggregations-Query liefert:

```
member_count: 12
source_count: 4
unique_authors_7d: 7
first_activity_at: 2025-11-12 08:30:00+00
last_activity_at: 2026-04-15 10:42:33+00
velocity_24h: 3
velocity_7d_avg: 1.43
spread_24h: 3
```

`activity_trend` neu berechnet: `velocity_24h (3) > velocity_7d_avg (1.43) * 1.5 = 2.14` → `growing`.

Stagnations-Pass: 2 von 12 Mitgliedern haben keine Folge-Aktivität seit 5 Tagen. Ratio 0.17 → `none`. (Im vorherigen Snapshot war es low — der Anteil hat sich durch das neue Member verschoben.)

Update läuft. Vorher-Nachher-Vergleich erkennt:

- `activity_trend` änderte sich: `stable` → `growing` ✓ signifikant
- `stagnation_severity` änderte sich: `low` → `none` ✓ signifikant

Activity-Updated-Event wird emittiert:

```json
{
  "event_type": "topic.activity.updated",
  "payload": {
    "topic_id": "topic:7c8d9e1f-2a3b-...",
    "trend": "growing",
    "stagnation_severity": "none",
    "velocity_24h": 3,
    "velocity_7d_avg": 1.43,
    "change_summary": "trend changed: stable → growing; stagnation: low → none"
  }
}
```

LLM-Bewerter reagiert darauf (siehe Zettel 8) und bewertet das Topic neu.

### Beispiel 2: Decay-Recompute bei dormant-Übergang

Topic war vor einer Woche aktiv, ist jetzt eine Woche lang ohne neue Mitglieder. Decay-Worker findet das Topic in der "stale"-Liste (`computed_at` älter als 2h), recomputet:

```
member_count: 8 (unverändert)
velocity_24h: 0 (war 2 vor 7 Tagen)
velocity_7d_avg: 0 (auch 0)
last_activity_at: 2026-04-08 14:00:00+00 (= 7 Tage alt)
```

`activity_trend`: `daysSinceLastActivity > 7` → `dormant`.

Vorheriger Trend war `stable`. Änderung: `stable → dormant` ✓ signifikant. Activity-Updated-Event wird emittiert.

LLM-Bewerter reagiert und kann das Topic neu klassifizieren — möglicherweise von `attention` auf `noteworthy` herab, weil keine neue Aktivität.

### Beispiel 3: Burst ohne Trend-Änderung

Slack-Burst während eines Meetings: 8 Messages innerhalb von 10 Minuten zu einem aktiven Topic. Worker triggert achtmal `recomputeTopic()`. `velocity_24h` steigt von 5 auf 13.

Vorheriger Trend war schon `growing`. Trend-Änderung? Nein, immer noch `growing`. Stagnation? Unverändert. Velocity 13 > 5 \* 2 = 10 → ja, signifikant.

Activity-Updated-Event wird emittiert. Aber: weil der Bewerter Debouncing hat (siehe Zettel 8), wird er nicht achtmal getriggert, sondern _einmal_ pro 5-Minuten-Fenster.

### Beispiel 4: Stagnations-Eskalation

Topic mit 6 Mitgliedern. Über die Tage: kein Mitglied bekommt Folge-Aktivität. Nach 5 Tagen seit dem ältesten Mitglied:

```
member_count: 6
stagnation_signal_count: 4 (alle bis auf 2 sind > 5 Tage alt ohne Folge)
ratio: 4/6 = 0.67
stagnation_severity: high
```

Vorher war severity `none`. Änderung: `none → high` ✓ signifikant. Event emittiert.

Der LLM-Bewerter sieht im Prompt jetzt Stagnations-Severity `high` und kann das als zentrales Signal werten — typischer Onboarding-Friction-Fall, wo Threads ohne Antwort liegen.

## Cross-Links

- Wer `discusses`-Edges erzeugt: [Zettel 5 — Clustering](./05_clustering.md)
- Wer auf Activity-Events reagiert: [Zettel 8 — LLM-Bewerter](./08_llm_bewerter.md)
- Wo die Aktivitätsfelder gelesen werden: [Zettel 6 — Tool-Layer](./06_tool_layer.md) (`list_topics`, `triage_topics`)
- Topics-Schema mit allen Aktivitäts-Spalten: [Zettel 3 — Materialisierer](./03_materialisierer.md)
