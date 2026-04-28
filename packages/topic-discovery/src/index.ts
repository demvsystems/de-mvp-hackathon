import {
  EmbeddingCreated,
  type ConsumerOptions,
  type EmbeddingCreatedPayload,
  type MessageContext,
  type Subscriber,
} from '@repo/messaging';
import { defaultDeps } from './defaultDeps';
import { discoverTopic } from './discover';
import { TOPIC_DISCOVERY_CONSUMER, TOPIC_DISCOVERY_FILTER_SUBJECT } from './provision';

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

export const topicDiscoveryModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: TOPIC_DISCOVERY_CONSUMER,
    filter_subject: TOPIC_DISCOVERY_FILTER_SUBJECT,
    deliver_policy: 'all',
  },
  register(sub) {
    sub.on(EmbeddingCreated, async (payload: EmbeddingCreatedPayload, ctx) => {
      await discoverTopic(payload, ctx, defaultDeps);
      trace(ctx);
    });
  },
};
