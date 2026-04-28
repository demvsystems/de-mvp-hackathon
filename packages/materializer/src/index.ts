import {
  closeConnection,
  createSubscriber,
  EdgeObserved,
  EmbeddingCreated,
  RecordDeleted,
  RecordObserved,
  RecordTombstoned,
  RecordUpdated,
  TopicArchived,
  TopicAssessmentCreated,
  TopicCreated,
  TopicSuperseded,
  TopicUpdated,
  type MessageContext,
} from '@repo/messaging';
import {
  handleAssessmentCreated,
  handleEdgeObserved,
  handleEmbeddingCreated,
  handleRecordDeleted,
  handleRecordObserved,
  handleTopicArchived,
  handleTopicCreated,
  handleTopicSuperseded,
  handleTopicUpdated,
} from './handlers';
import { MATERIALIZER_CONSUMER, provisionMaterializer } from './provision';

function trace(ctx: MessageContext, kind: string): void {
  console.log(
    JSON.stringify({
      msg: 'matz applied',
      kind,
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      seq: ctx.seq,
    }),
  );
}

async function main(): Promise<void> {
  await provisionMaterializer();

  const sub = createSubscriber({ consumer: MATERIALIZER_CONSUMER });

  sub
    .on(RecordObserved, async (payload, ctx) => {
      await handleRecordObserved(payload, ctx);
      trace(ctx, 'record.observed');
    })
    .on(RecordUpdated, async (payload, ctx) => {
      await handleRecordObserved(payload, ctx);
      trace(ctx, 'record.updated');
    })
    .on(RecordDeleted, async (payload, ctx) => {
      await handleRecordDeleted(payload, ctx);
      trace(ctx, 'record.deleted');
    })
    .on(RecordTombstoned, async (payload, ctx) => {
      // Tombstone semantics match deletion for the materializer's read-model:
      // soft-delete the record and invalidate its open edges.
      await handleRecordDeleted(payload, ctx);
      trace(ctx, 'record.tombstoned');
    })
    .on(EdgeObserved, async (payload, ctx) => {
      await handleEdgeObserved(payload, ctx);
      trace(ctx, 'edge.observed');
    })
    .on(EmbeddingCreated, async (payload, ctx) => {
      await handleEmbeddingCreated(payload);
      trace(ctx, 'embedding.created');
    })
    .on(TopicCreated, async (payload, ctx) => {
      await handleTopicCreated(payload, ctx);
      trace(ctx, 'topic.created');
    })
    .on(TopicUpdated, async (payload, ctx) => {
      await handleTopicUpdated(payload);
      trace(ctx, 'topic.updated');
    })
    .on(TopicArchived, async (payload, ctx) => {
      await handleTopicArchived(payload, ctx);
      trace(ctx, 'topic.archived');
    })
    .on(TopicSuperseded, async (payload, ctx) => {
      await handleTopicSuperseded(payload);
      trace(ctx, 'topic.superseded');
    })
    .on(TopicAssessmentCreated, async (payload, ctx) => {
      await handleAssessmentCreated(payload);
      trace(ctx, 'topic.assessment.created');
    });

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
