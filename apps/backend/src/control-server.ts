import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { WorkerRegistry } from './workers';

const ACTIONS = new Set(['start', 'stop', 'reset']);

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
    parts[0] === 'reviewer' &&
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
