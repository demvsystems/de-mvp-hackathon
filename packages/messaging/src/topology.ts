import { fileURLToPath } from 'node:url';
import { jetstreamManager, AckPolicy, DeliverPolicy } from '@nats-io/jetstream';
import { getConnection, closeConnection } from './connection';

export const STREAM_NAME = 'EVENTS';
export const STREAM_SUBJECTS = ['events.>'];

export async function provisionStream(): Promise<void> {
  const nc = await getConnection();
  const jsm = await jetstreamManager(nc);

  const config = {
    name: STREAM_NAME,
    subjects: STREAM_SUBJECTS,
    duplicate_window: 2 * 60 * 1_000_000_000,
  };

  try {
    await jsm.streams.add(config);
  } catch (err) {
    if (isAlreadyExists(err)) await jsm.streams.update(STREAM_NAME, config);
    else throw err;
  }
}

export interface ConsumerOptions {
  durable_name: string;
  filter_subject?: string;
  deliver_policy?: 'all' | 'new';
}

export async function provisionConsumer(opts: ConsumerOptions): Promise<void> {
  const nc = await getConnection();
  const jsm = await jetstreamManager(nc);

  const config = {
    durable_name: opts.durable_name,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: opts.deliver_policy === 'all' ? DeliverPolicy.All : DeliverPolicy.New,
    ...(opts.filter_subject !== undefined && { filter_subject: opts.filter_subject }),
  };

  try {
    await jsm.consumers.add(STREAM_NAME, config);
  } catch (err) {
    // Update on conflict so filter_subject changes propagate without manual
    // consumer deletion. Mirrors how provisionStream already updates on conflict.
    if (isAlreadyExists(err)) await jsm.consumers.update(STREAM_NAME, opts.durable_name, config);
    else throw err;
  }
}

export async function deleteConsumer(durable_name: string): Promise<void> {
  const nc = await getConnection();
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.consumers.delete(STREAM_NAME, durable_name);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('not found') || message.includes('no consumer');
}

function isAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('already in use') || message.includes('already exists');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await provisionStream();
    await provisionConsumer({ durable_name: 'demo-worker', deliver_policy: 'all' });
    console.log(`provisioned stream "${STREAM_NAME}" and consumer "demo-worker"`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
