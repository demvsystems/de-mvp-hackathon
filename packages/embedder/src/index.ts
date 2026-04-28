import {
  closeConnection,
  createSubscriber,
  RecordObserved,
  RecordUpdated,
  type MessageContext,
  type RecordPayload,
} from '@repo/messaging';
import { embedRecordBodyOnly } from './embed';
import { EMBEDDER_CONSUMER, provisionEmbedder } from './provision';

const SKIP_TYPES = new Set(['channel', 'repo', 'project', 'database', 'space', 'user']);

function trace(ctx: MessageContext, kind: string): void {
  console.log(
    JSON.stringify({
      msg: 'embedder applied',
      kind,
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      seq: ctx.seq,
    }),
  );
}

async function dispatch(payload: RecordPayload, ctx: MessageContext, kind: string): Promise<void> {
  if (SKIP_TYPES.has(payload.type)) return;
  await embedRecordBodyOnly(payload, ctx);
  trace(ctx, kind);
}

async function main(): Promise<void> {
  await provisionEmbedder();

  const sub = createSubscriber({ consumer: EMBEDDER_CONSUMER });

  sub
    .on(RecordObserved, (payload, ctx) => dispatch(payload, ctx, 'record.observed'))
    .on(RecordUpdated, (payload, ctx) => dispatch(payload, ctx, 'record.updated'));

  const shutdown = (signal: string): void => {
    console.log(`[embedder] received ${signal}, draining`);
    void sub
      .stop()
      .then(() => closeConnection())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[embedder] starting consumer "${EMBEDDER_CONSUMER}"`);
  await sub.start();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
