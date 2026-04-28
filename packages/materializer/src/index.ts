import {
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
  type ConsumerOptions,
  type MessageContext,
  type Subscriber,
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

export const materializerModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'materializer',
    filter_subject: 'events.>',
    deliver_policy: 'all',
  },
  register(sub) {
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
  },
};
