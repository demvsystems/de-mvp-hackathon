import {
  closeConnection,
  createSubscriber,
  EdgeObserved,
  RecordDeleted,
  RecordObserved,
  RecordTombstoned,
  RecordUpdated,
  TopicActivated,
  TopicArchived,
  TopicAssessmentCreated,
  TopicCreated,
  TopicSuperseded,
  type MessageContext,
} from '@repo/messaging';
import { MATERIALIZER_CONSUMER, provisionMaterializer } from './provision';

const stub =
  (kind: string) =>
  async (_payload: unknown, ctx: MessageContext): Promise<void> => {
    console.log(
      JSON.stringify({
        msg: 'matz routed',
        kind,
        event_id: ctx.envelope.event_id,
        event_type: ctx.envelope.event_type,
        subject_id: ctx.envelope.subject_id,
        seq: ctx.seq,
      }),
    );
    // TODO step 2: replace stubs with real handlers writing to @repo/db.
  };

async function main(): Promise<void> {
  await provisionMaterializer();

  const sub = createSubscriber({ consumer: MATERIALIZER_CONSUMER });

  sub
    .on(RecordObserved, stub('record.observed'))
    .on(RecordUpdated, stub('record.updated'))
    .on(RecordDeleted, stub('record.deleted'))
    .on(RecordTombstoned, stub('record.tombstoned'))
    .on(EdgeObserved, stub('edge.observed'))
    .on(TopicCreated, stub('topic.created'))
    .on(TopicActivated, stub('topic.activated'))
    .on(TopicArchived, stub('topic.archived'))
    .on(TopicSuperseded, stub('topic.superseded'))
    .on(TopicAssessmentCreated, stub('topic.assessment.created'));

  const shutdown = (signal: string): void => {
    console.log(`[materializer] received ${signal}, draining`);
    void sub
      .stop()
      .then(() => closeConnection())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[materializer] starting consumer "${MATERIALIZER_CONSUMER}"`);
  await sub.start();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
