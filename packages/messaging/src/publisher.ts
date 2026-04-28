import { jetstream } from '@nats-io/jetstream';
import { getConnection } from './connection';
import type { EventDefinition } from './event';

export async function publish<T>(
  event: EventDefinition<T>,
  payload: T,
  opts: { msgID?: string } = {},
): Promise<{ seq: number; stream: string }> {
  const validated = event.schema.parse(payload);
  const nc = await getConnection();
  const js = jetstream(nc);
  const ack = await js.publish(
    event.subject,
    JSON.stringify(validated),
    opts.msgID !== undefined ? { msgID: opts.msgID } : undefined,
  );
  return { seq: ack.seq, stream: ack.stream };
}
