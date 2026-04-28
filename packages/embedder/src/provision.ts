import { closeConnection, provisionConsumer, provisionStream } from '@repo/messaging';

export const EMBEDDER_CONSUMER = 'embedder';
export const EMBEDDER_FILTER_SUBJECT = 'events.record.>';

export async function provisionEmbedder(): Promise<void> {
  await provisionStream();
  await provisionConsumer({
    durable_name: EMBEDDER_CONSUMER,
    filter_subject: EMBEDDER_FILTER_SUBJECT,
    deliver_policy: 'all',
  });
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    await provisionEmbedder();
    console.log(
      `[embedder] provisioned consumer "${EMBEDDER_CONSUMER}" with filter "${EMBEDDER_FILTER_SUBJECT}"`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
