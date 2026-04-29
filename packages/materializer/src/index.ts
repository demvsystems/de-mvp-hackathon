import {
  publish,
  type EventDefinition,
  type PublishAck,
  type PublishInput,
  type AssessmentCreatedPayload,
  type EdgeObservedPayload,
  type EmbeddingCreatedPayload,
  type RecordIdPayload,
  type RecordPayload,
  type TopicArchivedPayload,
  type TopicCreatedPayload,
  type TopicSupersededPayload,
  type TopicUpdatedPayload,
} from '@repo/messaging';
import {
  persistAssessment,
  persistEdge,
  persistEmbedding,
  persistRecord,
  persistRecordDeleted,
  persistTopicArchived,
  persistTopicCreated,
  persistTopicSuperseded,
  persistTopicUpdated,
  type PersistCtx,
} from './persist';

export {
  persistAssessment,
  persistEdge,
  persistEmbedding,
  persistRecord,
  persistRecordDeleted,
  persistTopicArchived,
  persistTopicCreated,
  persistTopicSuperseded,
  persistTopicUpdated,
} from './persist';
export type { PersistCtx } from './persist';

// Routes an event payload to the matching persist function. Switch on
// event_type because EventDefinition<T> is generic at compile time but we
// resolve concrete payload shapes at runtime. system.* events have no DB
// effect and fall through silently.
export async function persistEvent<T>(
  event: EventDefinition<T>,
  payload: T,
  ctx: PersistCtx,
): Promise<void> {
  switch (event.event_type) {
    case 'record.observed':
    case 'record.updated':
      return persistRecord(payload as RecordPayload, ctx);
    case 'record.deleted':
    case 'record.tombstoned':
      return persistRecordDeleted(payload as RecordIdPayload, ctx);
    case 'edge.observed':
      return persistEdge(payload as EdgeObservedPayload, ctx);
    case 'embedding.created':
      return persistEmbedding(payload as EmbeddingCreatedPayload);
    case 'topic.created':
      return persistTopicCreated(payload as TopicCreatedPayload, ctx);
    case 'topic.updated':
      return persistTopicUpdated(payload as TopicUpdatedPayload);
    case 'topic.archived':
      return persistTopicArchived(payload as TopicArchivedPayload, ctx);
    case 'topic.superseded':
      return persistTopicSuperseded(payload as TopicSupersededPayload);
    case 'topic.assessment.created':
      return persistAssessment(payload as AssessmentCreatedPayload);
    default:
      return;
  }
}

export async function publishWithPersist<T>(
  event: EventDefinition<T>,
  input: PublishInput<T>,
): Promise<PublishAck> {
  await persistEvent(event, input.payload, {
    occurredAt: input.occurred_at,
    observedAt: new Date().toISOString(),
    evidence: input.evidence ?? null,
  });
  return publish(event, input);
}
