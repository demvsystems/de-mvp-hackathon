import type { Subscription } from '@nats-io/transport-node';

import { getConnection } from './connection';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export async function publishCore(subject: string, payload: unknown): Promise<void> {
  const nc = await getConnection();
  nc.publish(subject, ENCODER.encode(JSON.stringify(payload)));
}

export interface CoreSubscription {
  readonly stop: () => Promise<void>;
}

export async function subscribeCore(
  subject: string,
  onMessage: (payload: unknown, subject: string) => void,
): Promise<CoreSubscription> {
  const nc = await getConnection();
  const sub: Subscription = nc.subscribe(subject);
  (async () => {
    for await (const msg of sub) {
      try {
        const text = DECODER.decode(msg.data);
        const parsed = text.length > 0 ? JSON.parse(text) : null;
        onMessage(parsed, msg.subject);
      } catch (err) {
        console.warn(
          `[messaging.core] failed to decode message on ${msg.subject}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  })();
  return {
    stop: async () => {
      await sub.drain();
    },
  };
}
