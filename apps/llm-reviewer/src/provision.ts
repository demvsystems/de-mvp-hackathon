import { closeConnection, provisionConsumer, provisionStream } from '@repo/messaging';

export const REVIEWER_CONSUMER = 'llm-assessor';
export const REVIEWER_FILTER_SUBJECT = process.env['LLM_REVIEWER_FILTER'] ?? 'events.topic.>';

export async function provisionReviewer(): Promise<void> {
  await provisionStream();
  await provisionConsumer({
    durable_name: REVIEWER_CONSUMER,
    filter_subject: REVIEWER_FILTER_SUBJECT,
    deliver_policy: 'all',
  });
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  try {
    await provisionReviewer();
    console.log(
      `[llm-reviewer] provisioned consumer "${REVIEWER_CONSUMER}" with filter "${REVIEWER_FILTER_SUBJECT}"`,
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}
