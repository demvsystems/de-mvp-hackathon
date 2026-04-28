import { fileURLToPath } from 'node:url';
import { jetstreamManager, AckPolicy } from '@nats-io/jetstream';
import { getConnection, closeConnection } from './connection';

export const STREAM_NAME = 'EVENTS';
export const CONSUMER_NAME = 'worker';

const STREAM_SUBJECTS = ['events.>'];

export async function provisionTopology(): Promise<void> {
  const nc = await getConnection();
  const jsm = await jetstreamManager(nc);

  const streamConfig = {
    name: STREAM_NAME,
    subjects: STREAM_SUBJECTS,
    max_age: 24 * 60 * 60 * 1_000_000_000,
    duplicate_window: 2 * 60 * 1_000_000_000,
  };

  try {
    await jsm.streams.add(streamConfig);
  } catch (err) {
    if (isAlreadyExists(err)) await jsm.streams.update(STREAM_NAME, streamConfig);
    else throw err;
  }

  try {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

function isAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('already in use') || message.includes('already exists');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await provisionTopology();
    console.log(`provisioned stream "${STREAM_NAME}" and consumer "${CONSUMER_NAME}"`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
