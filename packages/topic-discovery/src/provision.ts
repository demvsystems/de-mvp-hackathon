import { closeConnection, provisionConsumer, provisionStream } from '@repo/messaging';

export const TOPIC_DISCOVERY_CONSUMER = 'topic-discovery';
export const TOPIC_DISCOVERY_FILTER_SUBJECT = 'events.embedding.created.body-only';

export async function provisionTopicDiscovery(): Promise<void> {
  await provisionStream();
  await provisionConsumer({
    durable_name: TOPIC_DISCOVERY_CONSUMER,
    filter_subject: TOPIC_DISCOVERY_FILTER_SUBJECT,
    deliver_policy: 'all',
  });
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    await provisionTopicDiscovery();
    console.log(
      `[topic-discovery] provisioned consumer "${TOPIC_DISCOVERY_CONSUMER}" with filter "${TOPIC_DISCOVERY_FILTER_SUBJECT}"`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
