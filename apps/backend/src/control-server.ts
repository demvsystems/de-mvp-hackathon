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
