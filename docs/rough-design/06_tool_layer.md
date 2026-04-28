# Zettel 6 — Tool-Layer

Die Konsumenten-Schnittstelle. Neun spezialisierte HTTP-Endpoints, die ein Agent oder UI nutzt, um auf den State zuzugreifen. Read-Only, deterministisch bezogen auf den Read-Model-Stand, nur lokal erreichbar im Pilot.

---

## Was

**Verantwortung.** HTTP-Endpoints für neun Tools, die alle gegen die Postgres-Read-Tabellen lesen. Universelles Result-Format mit Provenance pro Treffer. Determinismus-Garantie für Eval-Reproduzierbarkeit.

**Die neun Tools.**

| Tool                | Frage-Klasse                                          |
| ------------------- | ----------------------------------------------------- |
| `search`            | Hybrid-Suche über Records (lexical, semantic, hybrid) |
| `get_record`        | Einzel-Record-Lookup über ID                          |
| `get_recent`        | Browse ohne Query, temporal sortiert                  |
| `get_neighbors`     | Graph-Traversierung über Edges                        |
| `get_thread`        | Thread-Rekonstruktion (Slack, Jira-Comments etc.)     |
| `find_similar`      | On-demand Embedding-Search                            |
| `list_topics`       | Topic-Übersicht mit Filter und Sortierung             |
| `get_topic_context` | Topic-Detail mit Mitgliedern und State                |
| `triage_topics`     | Eskalations-/Chancen-Triage mit Reasoning             |

**Stack.**

- TypeScript/Node, ein Worker (HTTP-Server)
- Express oder Hono als Framework
- Postgres-Pool für Read-Zugriff
- Zod für Request-Validation
- Bind nur auf `localhost`/`127.0.0.1` im Pilot

**Was er nicht tut.**

- Keine Mutations (Tool-Layer ist read-only)
- Keine direkte Stream-Subscription (er liest nur Read-Tabellen)
- Keine eigene Authentifizierung im Pilot

## Wie

### HTTP-API-Konvention

Pro Tool ein POST-Endpoint mit JSON-Body. Begründung: Tool-Inputs sind oft strukturiert (Filter-Objekte, Pagination-Cursor, Listen) — JSON-Body ist klarer als Query-Parameter.

```
POST /tools/search
POST /tools/get_record
POST /tools/get_recent
POST /tools/get_neighbors
POST /tools/get_thread
POST /tools/find_similar
POST /tools/list_topics
POST /tools/get_topic_context
POST /tools/triage_topics
```

Pro Endpoint:

- Request-Body via Zod validiert
- Response ein JSON-Objekt mit `results`-Array plus optional `cursor` für Pagination
- HTTP-Status: 200 bei Erfolg, 400 bei Validation-Fehler, 500 bei Server-Fehler
- Content-Type: `application/json`

### Universal Result-Format

Jedes Tool, das eine Liste zurückliefert, nutzt dasselbe Format pro Item:

```typescript
type ResultItem = {
  id: string; // kanonische ID
  type: string; // record-Typ oder 'topic'
  title: string | null;
  snippet: string | null; // gekürzter Body, je nach Tool angereichert
  source: string; // 'slack' | 'github' | ... | 'topic'

  scoring: {
    score: number; // 0-1, je höher desto relevanter
    matched_via: MatchProvenance[]; // Liste der Match-Begründungen
  };

  metadata: Record<string, unknown>; // Tool-spezifisch
};

type MatchProvenance =
  | { type: 'lexical'; matched_terms: string[]; rank: number }
  | { type: 'semantic'; similarity: number; model_version: string }
  | { type: 'edge'; edge_type: string; edge_source: string; edge_confidence: number }
  | { type: 'topic_membership'; topic_id: string; topic_confidence: number }
  | { type: 'recency'; days_ago: number };
```

`scoring.matched_via` ist nicht Audit-Beigabe — der Agent kann daraus interpretieren, _warum_ ein Treffer erschien. Bei Hybrid-Search etwa enthält ein Treffer beide Begründungen (lexical und semantic), bei `get_neighbors` die Edge-Provenance.

Listen-Endpoints liefern zusätzlich:

```typescript
type ListResponse = {
  results: ResultItem[];
  cursor: string | null; // opaker String für nächste Seite
  total_count: number | null; // optional, falls billig zu berechnen
};
```

### Aliasing-Auflösung

Konsumenten dürfen kanonische IDs oder Display-Aliasse nutzen. Beispiel:

```typescript
get_record({ id: 'PRICE-42' }); // Display-Alias (Jira-Key)
get_record({ id: 'jira:issue:10042' }); // kanonische ID
```

Beide funktionieren. Die Aliasing-Logik lebt in einem zentralen Resolver:

```typescript
async function resolveId(input: string): Promise<string> {
  // Schon kanonisch?
  if (input.includes(':')) return input;

  // Jira-Key wie "PRICE-42"?
  if (/^[A-Z]+-\d+$/.test(input)) {
    const result = await db.queryMaybeOne(
      `
      SELECT id FROM records WHERE source = 'jira' AND payload->>'key' = $1
    `,
      [input],
    );
    if (result) return result.id;
  }

  // GitHub-Issue-Shortform "owner/repo#42"?
  if (/^[\w-]+\/[\w-]+#\d+$/.test(input)) {
    const [pathAndNum] = input.split('#');
    return `github:issue:${pathAndNum}/${input.split('#')[1]}`;
  }

  // Slack-Permalink?
  if (input.startsWith('https://') && input.includes('.slack.com')) {
    return parseSlackPermalink(input);
  }

  // Wenn nichts passt, geben wir den Input zurück und lassen den Lookup ggf. ins Leere laufen
  return input;
}
```

Vor jedem Tool-Call werden alle ID-Felder in der Request durch den Resolver geschickt. Damit ist die Aliasing-Logik zentralisiert und alle Tools profitieren ohne Extra-Code.

### Recency-Modell — drei orthogonale Knöpfe

In `search`, `list_topics`, `get_recent` werden Zeit-Aspekte über drei separate Parameter ausgedrückt:

```typescript
type RecencyParams = {
  recency_weight?: number; // 0-1, weiches Ranking-Signal
  time_range?: {
    // hartes Filter
    after?: string; // ISO-8601
    before?: string;
  };
  as_of?: string; // Wahrheits-Snapshot, ignoriert Updates danach
};
```

`recency_weight` verschiebt das Ranking — bei 1.0 dominiert Recency, bei 0.0 ist sie ignoriert. Implementiert als Multiplikation eines Decay-Faktors auf den Base-Score.

`time_range` schließt alles außerhalb des Zeitfensters aus, ohne Score-Effekt.

`as_of` ist im Pilot rudimentär: nur Records mit `updated_at <= as_of` werden berücksichtigt, neuere ignoriert. Voll bi-temporal (also auch Topic-Bewertungen zum Stichtag) kommt in Phase 2.

### Determinismus-Garantie

Identische Eingaben produzieren identische Resultate, solange die Read-Tabellen sich nicht ändern. Das ist Voraussetzung für reproduzierbares Eval. Konkret:

- Sortierung hat immer einen deterministischen Tie-Breaker (typisch `id ASC` als Last-Resort)
- Cursor-Pagination ist stabil — derselbe Cursor liefert dieselbe Antwort, auch wenn neue Records hinzu kamen
- Score-Normalisierung ist deterministisch (keine Random-Komponenten)

Snapshot-Konsistenz innerhalb eines Tool-Calls: alle Postgres-Queries laufen in derselben Read-Transaction (`BEGIN ISOLATION LEVEL REPEATABLE READ`), damit gleichzeitige Schreibvorgänge anderer Worker den Tool-Output nicht inkonsistent machen.

### Pro Tool — Beispiel-Implementations

#### `search`

```typescript
const SearchRequest = z.object({
  query: z.string().min(1),
  mode: z.enum(['lexical', 'semantic', 'hybrid']).default('hybrid'),
  filters: z
    .object({
      source: z.array(z.string()).optional(),
      type: z.array(z.string()).optional(),
      posted_in: z.array(z.string()).optional(),
      author: z.string().optional(),
    })
    .optional(),
  recency_weight: z.number().min(0).max(1).optional(),
  time_range: z
    .object({
      after: z.string().datetime().optional(),
      before: z.string().datetime().optional(),
    })
    .optional(),
  as_of: z.string().datetime().optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

async function handleSearch(req: SearchRequest): Promise<ListResponse> {
  // Lexical-Pfad: GIN-Index auf search_vector
  // Semantic-Pfad: HNSW-Lookup auf embeddings + Join zu records
  // Hybrid: Reciprocal-Rank-Fusion der beiden Pfade

  const lexicalResults = req.mode !== 'semantic' ? await runLexicalSearch(req) : [];
  const semanticResults = req.mode !== 'lexical' ? await runSemanticSearch(req) : [];

  const merged =
    req.mode === 'hybrid'
      ? reciprocalRankFusion(lexicalResults, semanticResults)
      : req.mode === 'lexical'
        ? lexicalResults
        : semanticResults;

  const ranked = applyRecencyWeight(merged, req.recency_weight);
  const paginated = applyCursor(ranked, req.cursor, req.limit);

  return {
    results: paginated.items,
    cursor: paginated.nextCursor,
    total_count: null, // kein COUNT bei großen Tabellen
  };
}
```

#### `get_record`

Einfachster Fall — ein Record-Lookup mit Aliasing:

```typescript
async function handleGetRecord(req: { id: string }): Promise<ResultItem | null> {
  const canonicalId = await resolveId(req.id);

  const record = await db.queryMaybeOne(
    `
    SELECT id, type, source, title, body, payload, created_at, updated_at
    FROM records
    WHERE id = $1 AND is_deleted = false
  `,
    [canonicalId],
  );

  if (!record) return null;

  return {
    id: record.id,
    type: record.type,
    title: record.title,
    snippet: record.body ? truncate(record.body, 300) : null,
    source: record.source,
    scoring: { score: 1.0, matched_via: [{ type: 'lexical', matched_terms: [], rank: 0 }] },
    metadata: {
      created_at: record.created_at,
      updated_at: record.updated_at,
      payload: record.payload,
    },
  };
}
```

#### `get_neighbors`

Graph-Traversierung über Edges:

```typescript
async function handleGetNeighbors(req: GetNeighborsRequest): Promise<ListResponse> {
  const fromId = await resolveId(req.id);
  const edgeTypes = req.edge_types ?? [
    'authored_by',
    'replies_to',
    'commented_on',
    'posted_in',
    'mentions',
    'discusses',
  ];

  const edges = await db.query(
    `
    SELECT e.from_id, e.to_id, e.type, e.confidence, e.source, e.evidence,
           r.id as record_id, r.type as record_type, r.title, r.body, r.source as record_source
    FROM edges e
    LEFT JOIN records r ON r.id = e.to_id
    WHERE e.from_id = $1
      AND e.type = ANY($2::text[])
      AND e.valid_to IS NULL
    ORDER BY e.confidence DESC, e.observed_at DESC
    LIMIT $3
  `,
    [fromId, edgeTypes, req.limit ?? 50],
  );

  return {
    results: edges.map((e) => ({
      id: e.record_id ?? e.to_id,
      type: e.record_type ?? 'unknown',
      title: e.title,
      snippet: e.body ? truncate(e.body, 200) : null,
      source: e.record_source ?? extractSourceFromId(e.to_id),
      scoring: {
        score: e.confidence,
        matched_via: [
          {
            type: 'edge',
            edge_type: e.type,
            edge_source: e.source,
            edge_confidence: e.confidence,
          },
        ],
      },
      metadata: { evidence: e.evidence },
    })),
    cursor: null, // einfache Variante ohne Pagination
    total_count: edges.length,
  };
}
```

#### `triage_topics`

Das relevanteste Tool für die zentrale Hypothese:

```typescript
const TriageRequest = z.object({
  character: z
    .array(z.enum(['attention', 'opportunity', 'noteworthy', 'calm']))
    .default(['attention', 'opportunity']), // Standard: nur handlungsrelevante
  min_score: z.number().min(0).max(1).optional(),
  time_window: z.string().optional(), // z.B. '7d'
  limit: z.number().int().min(1).max(50).default(20),
});

async function handleTriageTopics(req: TriageRequest): Promise<ListResponse> {
  const cutoff = req.time_window ? new Date(Date.now() - parseTimeWindow(req.time_window)) : null;

  // Letzte Bewertung pro Topic (DISTINCT ON)
  const assessments = await db.query(
    `
    SELECT DISTINCT ON (a.topic_id) 
           a.topic_id, a.character, a.escalation_score, a.reasoning, a.assessed_at,
           t.label, t.last_activity_at, t.member_count, t.source_count, t.stagnation_severity
    FROM topic_assessments a
    JOIN topics t ON t.id = a.topic_id
    WHERE t.status = 'active'
      AND a.character = ANY($1::text[])
      ${cutoff ? 'AND a.assessed_at >= $2' : ''}
      ${req.min_score ? `AND a.escalation_score >= $${cutoff ? 3 : 2}` : ''}
    ORDER BY a.topic_id, a.assessed_at DESC
  `,
    [req.character, ...(cutoff ? [cutoff] : []), ...(req.min_score ? [req.min_score] : [])],
  );

  // Sortierung: erst nach character (attention vor opportunity), dann score, dann recency
  assessments.sort(byCharacterThenScoreThenRecency);

  return {
    results: assessments.slice(0, req.limit).map((a) => ({
      id: a.topic_id,
      type: 'topic',
      title: a.label,
      snippet: extractSnippetFromReasoning(a.reasoning),
      source: 'topic',
      scoring: {
        score: a.escalation_score,
        matched_via: [{ type: 'topic_membership', topic_id: a.topic_id, topic_confidence: 1.0 }],
      },
      metadata: {
        character: a.character,
        reasoning: a.reasoning,
        last_activity_at: a.last_activity_at,
        member_count: a.member_count,
        source_count: a.source_count,
        stagnation_severity: a.stagnation_severity,
      },
    })),
    cursor: null,
    total_count: assessments.length,
  };
}
```

#### `find_similar`

```typescript
async function handleFindSimilar(req: FindSimilarRequest): Promise<ListResponse> {
  const recordId = await resolveId(req.id);
  const modelVersion = req.model_version ?? 'openai-small-3:body-only:v1';

  // Quell-Embedding laden
  const source = await db.queryOne(
    `
    SELECT vector FROM embeddings WHERE record_id = $1 AND chunk_idx = 0 AND model_version = $2
  `,
    [recordId, modelVersion],
  );

  // Nächste Nachbarn finden (ohne Self)
  const neighbors = await db.query(
    `
    SELECT e.record_id, 1 - (e.vector <=> $1) AS similarity,
           r.title, r.body, r.type, r.source
    FROM embeddings e
    JOIN records r ON r.id = e.record_id AND r.is_deleted = false
    WHERE e.model_version = $2 AND e.record_id != $3
    ORDER BY e.vector <=> $1
    LIMIT $4
  `,
    [source.vector, modelVersion, recordId, req.limit ?? 10],
  );

  return {
    results: neighbors.map((n) => ({
      id: n.record_id,
      type: n.type,
      title: n.title,
      snippet: n.body ? truncate(n.body, 200) : null,
      source: n.source,
      scoring: {
        score: n.similarity,
        matched_via: [
          {
            type: 'semantic',
            similarity: n.similarity,
            model_version: modelVersion,
          },
        ],
      },
      metadata: {},
    })),
    cursor: null,
    total_count: neighbors.length,
  };
}
```

### Cursor-Pagination

Cursor ist ein opaker String, im Pilot ein Base64-encoded JSON mit Keyset-Position:

```typescript
type CursorState = {
  last_score: number;
  last_id: string; // Tie-Breaker
};

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function applyCursor<T extends { score: number; id: string }>(
  items: T[],
  cursor: string | null | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  let filtered = items;
  if (cursor) {
    const state = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    filtered = items.filter(
      (i) => i.score < state.last_score || (i.score === state.last_score && i.id > state.last_id),
    );
  }

  const page = filtered.slice(0, limit);
  const nextCursor =
    page.length === limit
      ? encodeCursor({ last_score: page[page.length - 1].score, last_id: page[page.length - 1].id })
      : null;

  return { items: page, nextCursor };
}
```

Keyset-Pagination ist robust gegen Inserts während der Pagination — Offset-Pagination wäre nicht stabil.

## Warum

**Warum HTTP statt MCP im Pilot?** Pilot-Pragmatismus. HTTP ist universell zugänglich (curl, Postman, browser-fetch, MCP-Bridges können dahinter geschaltet werden), gut testbar, debug-freundlich. MCP ist ein wertvoller Schritt in Produktion, wenn die Tools direkt von Claude oder anderen Agents konsumiert werden — aber das ist additiv. Eine MCP-Bridge vor dem HTTP-Server ist später möglich, ohne Tool-Code zu ändern.

**Warum nur localhost?** Auth ist Phase 2. Multi-Tenant-Konfiguration, Rolle-basierte Zugriffe, API-Keys — alles relevant in Produktion, im Pilot Overhead. Localhost-Bind ist der einfachste Weg, das Tool nicht aus Versehen zu exponieren.

**Warum POST statt GET?** Strukturierte Filter-Objekte, Pagination-Cursor, Listen — als Query-Parameter unleserlich (URL-encoded JSON-Schmerz). POST mit JSON-Body ist klarer. Trade-off: keine native Browser-Caching, aber das ist im Pilot egal.

**Warum Universal Result-Format?** Konsumenten bekommen einheitliche Strukturen über alle Tools. Ein Agent, der zwischen `search` und `get_neighbors` und `triage_topics` navigiert, muss nicht jedes Mal andere JSON-Strukturen parsen. Das `matched_via`-Feld macht Tool-übergreifende Provenance explizit.

**Warum Aliasing-Resolver zentral?** Ohne zentralen Resolver müsste jedes Tool die Aliasing-Logik selbst implementieren — Code-Duplikation, Inkonsistenzen, jeder Bug in jedem Tool. Mit zentralem Resolver ist die Logik an einer Stelle, und alle Tools profitieren automatisch.

**Warum drei separate Recency-Knöpfe?** Konsumenten meinen unterschiedliche Sachen mit "ich will neuere Sachen". `recency_weight` für weiches Ranking, `time_range` für hartes Filtern, `as_of` für Snapshot-Konsistenz. Diese Trennung verhindert dass Tools Mehrdeutigkeit raten müssen.

**Warum Read-Only?** Mutations sind philosophisch ein anderer Vertrag — sie ändern State, brauchen Auth, brauchen Audit. Im Pilot mit Single-Tenant und read-only ist das System getestbar und reproduzierbar. Mutations (Curator-UI für Topic-Merge, manuelle Bewertungs-Korrekturen) kommen Phase 2.

**Warum Determinismus-Garantie?** Eval reproduzierbar zu machen ist ein expliziter Pilot-Wert. Ohne Determinismus könnten zwei Eval-Runs unterschiedliche Ergebnisse liefern, ohne dass etwas im Code geändert wurde — und niemand könnte sagen, ob ein neuer Bewerter wirklich besser ist oder nur Glück hatte.

**Warum HNSW + GIN parallel statt einer kombinierter Index?** Lexical-Suche und Semantic-Suche sind algorithmisch verschiedene Probleme. HNSW löst Vector-Nearest-Neighbor, GIN löst Inverted-Index-Lookup. Beide laufen parallel, der Hybrid-Search-Code merged sie über Reciprocal-Rank-Fusion. Versuch eines kombinierten Index würde beide Algorithmen kompromittieren.

## Beispiele

### Beispiel: Search-Aufruf

Request:

```json
POST /tools/search
{
  "query": "BiPro Bestandsübertragung",
  "mode": "hybrid",
  "filters": { "source": ["slack", "intercom"] },
  "recency_weight": 0.3,
  "limit": 5
}
```

Response:

```json
{
  "results": [
    {
      "id": "slack:msg:T01ABC/C02DEF/1714028591.012345",
      "type": "message",
      "title": null,
      "snippet": "Stimmt — und der gleiche Einwand kam letzte Woche schon. Ist das DEMV-4127?",
      "source": "slack",
      "scoring": {
        "score": 0.872,
        "matched_via": [
          { "type": "lexical", "matched_terms": ["BiPro"], "rank": 1 },
          { "type": "semantic", "similarity": 0.82, "model_version": "openai-small-3:body-only:v1" }
        ]
      },
      "metadata": {
        "created_at": "2026-04-15T09:23:11.000Z",
        "updated_at": "2026-04-15T09:23:11.000Z",
        "channel_id": "C02DEF"
      }
    },
    {
      "id": "intercom:thread:abc123",
      "type": "message",
      "title": null,
      "snippet": "Hab gerade wieder einen Vertrag zur Bestandsübertragung an POOL_EXTERN_01 gegeben...",
      "source": "intercom",
      "scoring": {
        "score": 0.806,
        "matched_via": [
          { "type": "lexical", "matched_terms": ["Bestandsübertragung"], "rank": 2 },
          { "type": "semantic", "similarity": 0.79, "model_version": "openai-small-3:body-only:v1" }
        ]
      },
      "metadata": {
        "created_at": "2026-01-22T14:15:00.000Z",
        "updated_at": "2026-01-22T14:15:00.000Z"
      }
    }
  ],
  "cursor": "eyJsYXN0X3Njb3JlIjowLjgwNiwibGFzdF9pZCI6ImludGVyY29tOnRocmVhZDphYmMxMjMifQ",
  "total_count": null
}
```

### Beispiel: triage_topics-Aufruf

Request:

```json
POST /tools/triage_topics
{
  "character": ["attention", "opportunity"],
  "limit": 10
}
```

Response:

```json
{
  "results": [
    {
      "id": "topic:7c8d9e1f-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
      "type": "topic",
      "title": "BiPro 430.4 / Concordia-Bestandsverlust",
      "snippet": "Verstärkt frustriert, eskalierend über 4 Quellen. Jira-Ticket DEMV-4127 niedrig priorisiert trotz hoher Belegdichte.",
      "source": "topic",
      "scoring": {
        "score": 0.84,
        "matched_via": [
          { "type": "topic_membership", "topic_id": "topic:7c8d9e1f-...", "topic_confidence": 1.0 }
        ]
      },
      "metadata": {
        "character": "attention",
        "reasoning": {
          "sentiment_aggregate": "verstärkt frustriert",
          "key_signals": [
            "zwei neue Slack-Threads in 24h",
            "WON_DEAL_005 erwähnt Topic als Risiko",
            "Jira-Priorität Low vs. Belegdichte hoch"
          ],
          "key_artifacts": ["slack:msg:T01ABC/C02DEF/1714028591.012345", "jira:issue:10042"]
        },
        "last_activity_at": "2026-04-15T10:42:33.000Z",
        "member_count": 12,
        "source_count": 4,
        "stagnation_severity": "low"
      }
    }
  ],
  "cursor": null,
  "total_count": 1
}
```

### Beispiel: get_neighbors-Aufruf

Request:

```json
POST /tools/get_neighbors
{
  "id": "DEMV-4127",
  "edge_types": ["mentions", "commented_on", "discusses"],
  "limit": 20
}
```

Aliasing-Resolver übersetzt `DEMV-4127` zu `jira:issue:10042`. Response zeigt alle Records, die das Issue erwähnen oder kommentieren, plus die Topic-Mitgliedschaft.

## Cross-Links

- Welche Daten liegen in den Tabellen: [Zettel 3 — Materialisierer](./03_materialisierer.md)
- Wer schreibt die Topic-Bewertungen: separater Bewerter (im Pilot LLM-Bewerter, hier nicht detailliert)
- `find_similar` arbeitet auf Embeddings: [Zettel 4 — Embedding](./04_embedding.md)
- Topic-Mitgliedschaft kommt von: [Zettel 5 — Clustering](./05_clustering.md)
