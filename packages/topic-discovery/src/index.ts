import {
  EmbeddingCreated,
  closeConnection,
  createSubscriber,
  type MessageContext,
  type EmbeddingCreatedPayload,
} from '@repo/messaging';
import { defaultDeps } from './defaultDeps';
import { discoverTopic } from './discover';
import { TOPIC_DISCOVERY_CONSUMER, provisionTopicDiscovery } from './provision';

function trace(ctx: MessageContext): void {
  console.log(
    JSON.stringify({
      msg: 'topic-discovery applied',
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      seq: ctx.seq,
    }),
  );
}

async function main(): Promise<void> {
  await provisionTopicDiscovery();

  const sub = createSubscriber({ consumer: TOPIC_DISCOVERY_CONSUMER });

  sub.on(EmbeddingCreated, async (payload: EmbeddingCreatedPayload, ctx) => {
    await discoverTopic(payload, ctx, defaultDeps);
    trace(ctx);
  });

  const shutdown = (signal: string): void => {
    console.log(`[topic-discovery] received ${signal}, draining`);
    void sub
      .stop()
      .then(() => closeConnection())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[topic-discovery] starting consumer "${TOPIC_DISCOVERY_CONSUMER}"`);
  await sub.start();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
