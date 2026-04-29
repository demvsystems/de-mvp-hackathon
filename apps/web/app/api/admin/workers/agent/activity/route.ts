import { AGENT_ACTIVITY_SUBJECT_PREFIX } from '@repo/agent/shared';
import { subscribeCore, type CoreSubscription } from '@repo/messaging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTIVITY_SUBJECT = `${AGENT_ACTIVITY_SUBJECT_PREFIX}.>`;

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let subscription: CoreSubscription | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed (client disconnected)
        }
      };

      send('hello', { subject: ACTIVITY_SUBJECT, ts: new Date().toISOString() });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          // ignored
        }
      }, 15_000);

      try {
        subscription = await subscribeCore(ACTIVITY_SUBJECT, (payload) => {
          send('activity', payload);
        });
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }

      req.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        if (subscription) {
          subscription.stop().catch(() => {});
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (subscription) {
        subscription.stop().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
