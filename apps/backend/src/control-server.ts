import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkerRegistry } from './workers';

const ACTIONS = new Set(['start', 'stop', 'reset']);
const REVIEWER = 'reviewer';

export function startControlServer(registry: WorkerRegistry, port: number): Server {
  const server = createServer((req, res) => {
    handle(req, res, registry).catch((err) => {
      console.error('[backend:control] handler error:', err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  server.listen(port, '127.0.0.1', () => {
    console.error(`[backend:control] listening on http://127.0.0.1:${port}`);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  registry: WorkerRegistry,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && parts.length === 1 && parts[0] === 'workers') {
    sendJson(res, 200, { workers: registry.list() });
    return;
  }

  if (
    req.method === 'POST' &&
    parts.length === 2 &&
    parts[0] === REVIEWER &&
    parts[1] === 'reset-assessments'
  ) {
    try {
      const result = await resetReviewerAssessments();
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (
    req.method === 'POST' &&
    parts.length === 4 &&
    parts[0] === REVIEWER &&
    parts[1] === 'topics' &&
    parts[3] === 'run'
  ) {
    try {
      const result = await triggerReviewerForTopic(registry, decodeURIComponent(parts[2] ?? ''));
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workers') {
    const [, name, action] = parts as [string, string, string];
    if (!ACTIONS.has(action)) {
      sendJson(res, 400, { error: `unknown action: ${action}` });
      return;
    }
    if (!registry.names().includes(name)) {
      sendJson(res, 404, { error: `unknown worker: ${name}` });
      return;
    }
    try {
      const info =
        action === 'start'
          ? await registry.start(name)
          : action === 'stop'
            ? await registry.stop(name)
            : await registry.reset(name);
      sendJson(res, 200, { worker: info });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

interface ResetReviewerResult {
  deleted_assessments: number;
  retriggered_topics: number;
}

interface TriggerReviewerTopicResult {
  topic_id: string;
  started_worker: boolean;
  worker_state: string;
  event_id: string;
}

interface ActiveTopicRow {
  id: string;
  label: string | null;
  description: string | null;
  memberCount: number;
}

interface GuardrailFixtureRecord {
  id: string;
  type: string;
  source: string;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface GuardrailFixtureEdge {
  from_id: string;
  to_id: string;
  type: string;
  source: string;
  confidence: number;
  weight: number;
  valid_from: string;
  valid_to: string | null;
  observed_at: string;
}

interface GuardrailFixtureTopic {
  id: string;
  status: 'active';
  label: string | null;
  description: string | null;
  discovered_at: string;
  discovered_by: string;
  member_count: number;
  source_count: number;
  unique_authors_7d: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
  velocity_24h: number | null;
  velocity_7d_avg: number | null;
  spread_24h: number | null;
  activity_trend: string | null;
  computed_at: string | null;
  stagnation_signal_count: number;
  stagnation_severity: string;
  payload: Record<string, unknown>;
}

interface GuardrailFixture {
  id: string;
  category: 'happy' | 'edge' | 'adversarial';
  topic: GuardrailFixtureTopic;
  records: GuardrailFixtureRecord[];
  edges: GuardrailFixtureEdge[];
}

// Wipe all topic_assessments and re-publish TopicCreated for every active
// topic so the reviewer (if running) re-evaluates them. Lazy-imports keep
// `--workers connectors`-style runs from pulling in DATABASE_URL.
async function resetReviewerAssessments(): Promise<ResetReviewerResult> {
  const [{ sql }, { publishWithPersist }, { TopicCreated }] = await Promise.all([
    import('@repo/db'),
    import('@repo/materializer'),
    import('@repo/messaging'),
  ]);

  const topics = await sql<
    { id: string; discovered_by: string; member_count: number }[]
  >`SELECT id, discovered_by, member_count FROM topics WHERE status = 'active'`;

  const deleted = await sql`DELETE FROM topic_assessments`;
  const deletedCount = deleted.count;

  let retriggered = 0;
  for (const t of topics) {
    const members = await sql<{ from_id: string }[]>`
      SELECT from_id FROM edges WHERE to_id = ${t.id} AND type = 'discusses'
    `;
    await publishWithPersist(TopicCreated, {
      source: 'reset:reviewer',
      occurred_at: new Date().toISOString(),
      subject_id: t.id,
      correlation_id: t.id,
      payload: {
        id: t.id,
        status: 'active',
        discovered_by: t.discovered_by,
        initial_centroid_summary: {
          sample_record_ids: members.map((m: { from_id: string }) => m.from_id),
          cluster_size: t.member_count,
          intra_cluster_distance_avg: 0,
        },
        centroid: null,
        member_count: t.member_count,
      },
    });
    retriggered += 1;
  }

  return { deleted_assessments: deletedCount, retriggered_topics: retriggered };
}

async function triggerReviewerForTopic(
  registry: WorkerRegistry,
  topicId: string,
): Promise<TriggerReviewerTopicResult> {
  if (!topicId) throw new Error('missing topic id');

  const before = registry.list().find((worker) => worker.name === REVIEWER);
  if (!before) throw new Error(`unknown worker: ${REVIEWER}`);

  let startedWorker = false;
  let worker = before;
  if (worker.state !== 'running' && worker.state !== 'starting') {
    worker = await registry.start(REVIEWER);
    startedWorker = true;
  }

  const [{ sql }, { publish, TopicUpdated }] = await Promise.all([
    import('@repo/db'),
    import('@repo/messaging'),
  ]);

  let topic = await getActiveTopic(sql, topicId);
  if (!topic) {
    await seedGuardrailFixtureTopic(sql, topicId);
    topic = await getActiveTopic(sql, topicId);
  }
  if (!topic) throw new Error(`active topic not found: ${topicId}`);

  const ack = await publish(TopicUpdated, {
    source: 'control:reviewer',
    occurred_at: new Date().toISOString(),
    subject_id: topic.id,
    correlation_id: topic.id,
    payload: {
      id: topic.id,
      label: topic.label,
      description: topic.description,
      centroid: null,
      member_count: topic.memberCount,
    },
  });

  return {
    topic_id: topic.id,
    started_worker: startedWorker,
    worker_state: worker.state,
    event_id: ack.event_id,
  };
}

async function getActiveTopic(
  sql: typeof import('@repo/db').sql,
  topicId: string,
): Promise<ActiveTopicRow | undefined> {
  const rows = await sql<ActiveTopicRow[]>`
    SELECT id,
           label,
           description,
           member_count AS "memberCount"
      FROM topics
     WHERE id = ${topicId}
       AND status = 'active'
     LIMIT 1
  `;

  return rows[0];
}

function evalGoldenDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'eval', 'golden');
}

async function loadGuardrailFixture(topicId: string): Promise<GuardrailFixture | undefined> {
  const raw = await readFile(resolve(evalGoldenDir(), 'adversarial.jsonl'), 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const fixture = JSON.parse(line) as GuardrailFixture;
    if (fixture.category === 'adversarial' && fixture.topic.id === topicId) {
      return fixture;
    }
  }

  return undefined;
}

async function seedGuardrailFixtureTopic(
  sql: typeof import('@repo/db').sql,
  topicId: string,
): Promise<void> {
  const fixture = await loadGuardrailFixture(topicId);
  if (!fixture) return;

  const ingestedAt = new Date().toISOString();

  await sql.begin(async (tx) => {
    for (const record of fixture.records) {
      await tx`
        INSERT INTO records (id, type, source, title, body, payload,
                             created_at, updated_at, ingested_at, is_deleted)
        VALUES (${record.id}, ${record.type}, ${record.source}, ${record.title}, ${record.body},
                ${JSON.stringify(record.payload)}::jsonb,
                ${record.created_at}, ${record.updated_at}, ${ingestedAt}, false)
        ON CONFLICT (id) DO UPDATE
          SET type        = EXCLUDED.type,
              source      = EXCLUDED.source,
              title       = EXCLUDED.title,
              body        = EXCLUDED.body,
              payload     = EXCLUDED.payload,
              created_at  = EXCLUDED.created_at,
              updated_at  = EXCLUDED.updated_at,
              ingested_at = EXCLUDED.ingested_at,
              is_deleted  = false
      `;
    }

    const topic = fixture.topic;
    await tx`
      INSERT INTO topics (
        id, status, label, description,
        discovered_at, discovered_by,
        member_count, source_count, unique_authors_7d,
        first_activity_at, last_activity_at,
        velocity_24h, velocity_7d_avg, spread_24h,
        activity_trend, computed_at,
        stagnation_signal_count, stagnation_severity,
        payload
      ) VALUES (
        ${topic.id}, ${topic.status}, ${topic.label}, ${topic.description},
        ${topic.discovered_at}, ${topic.discovered_by},
        ${topic.member_count}, ${topic.source_count}, ${topic.unique_authors_7d},
        ${topic.first_activity_at}, ${topic.last_activity_at},
        ${topic.velocity_24h}, ${topic.velocity_7d_avg}, ${topic.spread_24h},
        ${topic.activity_trend}, ${topic.computed_at},
        ${topic.stagnation_signal_count}, ${topic.stagnation_severity},
        ${JSON.stringify(topic.payload)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE
        SET status                   = EXCLUDED.status,
            label                    = EXCLUDED.label,
            description              = EXCLUDED.description,
            discovered_at            = EXCLUDED.discovered_at,
            discovered_by            = EXCLUDED.discovered_by,
            member_count             = EXCLUDED.member_count,
            source_count             = EXCLUDED.source_count,
            unique_authors_7d        = EXCLUDED.unique_authors_7d,
            first_activity_at        = EXCLUDED.first_activity_at,
            last_activity_at         = EXCLUDED.last_activity_at,
            velocity_24h             = EXCLUDED.velocity_24h,
            velocity_7d_avg          = EXCLUDED.velocity_7d_avg,
            spread_24h               = EXCLUDED.spread_24h,
            activity_trend           = EXCLUDED.activity_trend,
            computed_at              = EXCLUDED.computed_at,
            stagnation_signal_count  = EXCLUDED.stagnation_signal_count,
            stagnation_severity      = EXCLUDED.stagnation_severity,
            payload                  = EXCLUDED.payload
    `;

    for (const edge of fixture.edges) {
      await tx`
        INSERT INTO edges (from_id, to_id, type, source,
                           confidence, weight,
                           valid_from, valid_to, observed_at, evidence)
        VALUES (${edge.from_id}, ${edge.to_id}, ${edge.type}, ${edge.source},
                ${edge.confidence}, ${edge.weight},
                ${edge.valid_from}, ${edge.valid_to}, ${edge.observed_at}, NULL)
        ON CONFLICT (from_id, to_id, type, source) DO UPDATE
          SET confidence  = EXCLUDED.confidence,
              weight      = EXCLUDED.weight,
              valid_from  = EXCLUDED.valid_from,
              valid_to    = EXCLUDED.valid_to,
              observed_at = EXCLUDED.observed_at
      `;
    }
  });
}
