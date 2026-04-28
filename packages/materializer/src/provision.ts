import { closeConnection, provisionConsumer, provisionStream } from '@repo/messaging';

export const MATERIALIZER_CONSUMER = 'materializer';
export const MATERIALIZER_FILTER_SUBJECT = 'events.>';

export async function provisionMaterializer(): Promise<void> {
  await provisionStream();
  await provisionConsumer({
    durable_name: MATERIALIZER_CONSUMER,
    filter_subject: MATERIALIZER_FILTER_SUBJECT,
    deliver_policy: 'all',
  });
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    await provisionMaterializer();
    console.log(
      `[materializer] provisioned consumer "${MATERIALIZER_CONSUMER}" with filter "${MATERIALIZER_FILTER_SUBJECT}"`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
