import { randomUUID } from 'node:crypto';
import {
  EdgeObserved,
  TopicCreated,
  TopicUpdated,
  publish,
  type EmbeddingCreatedPayload,
  type MessageContext,
} from '@repo/messaging';
import {
  DISTANCE_THRESHOLD_BODY_ONLY,
  STRATEGY_BODY_ONLY,
  TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
  confidenceFromDistance,
  parseStrategy,
  vectorLiteral,
} from './cluster';

export interface NearestTopicState {
  readonly id: string;
  readonly distance: number;
  readonly centroid: readonly number[];
  readonly memberCount: number;
}

export interface DiscoveryDeps {
  findNearestActiveTopic(vectorLit: string): Promise<NearestTopicState | null>;
  publish: typeof publish;
}

function incrementalMean(
  curr: readonly number[],
  count: number,
  next: readonly number[],
): number[] {
  const denom = count + 1;
  const out = new Array<number>(curr.length);
  for (let i = 0; i < curr.length; i += 1) {
    out[i] = ((curr[i] ?? 0) * count + (next[i] ?? 0)) / denom;
  }
  return out;
}

export async function discoverTopic(
  payload: EmbeddingCreatedPayload,
  ctx: MessageContext,
  deps: DiscoveryDeps,
): Promise<void> {
  if (parseStrategy(payload.model_version) !== STRATEGY_BODY_ONLY) return;

  const vectorLit = vectorLiteral(payload.vector);
  const occurredAt = new Date().toISOString();
  const threshold = DISTANCE_THRESHOLD_BODY_ONLY;

  const nearest = await deps.findNearestActiveTopic(vectorLit);

  let topicId: string;
  let distance: number;

  if (nearest && nearest.distance <= threshold) {
    topicId = nearest.id;
    distance = nearest.distance;

    const newCentroid = incrementalMean(nearest.centroid, nearest.memberCount, payload.vector);
    const newMemberCount = nearest.memberCount + 1;

    await deps.publish(TopicUpdated, {
      source: TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
      occurred_at: occurredAt,
      subject_id: topicId,
      payload: {
        id: topicId,
        label: null,
        description: null,
        centroid_body_only: newCentroid,
        member_count_body_only: newMemberCount,
      },
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
    });
  } else {
    topicId = `topic:${randomUUID()}`;
    distance = 0;

    await deps.publish(TopicCreated, {
      source: TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
      occurred_at: occurredAt,
      subject_id: topicId,
      payload: {
        id: topicId,
        status: 'active',
        discovered_by: TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
        initial_centroid_summary: {
          sample_record_ids: [payload.record_id],
          cluster_size: 1,
          intra_cluster_distance_avg: 0,
        },
        centroid_body_only: [...payload.vector],
        member_count_body_only: 1,
      },
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
    });
  }

  const embeddingId = `embedding:${payload.record_id}:${payload.chunk_idx}:${payload.model_version}`;
  const edgeSubjectId = `edge:discusses:${payload.record_id}->${topicId}:${TOPIC_DISCOVERY_SOURCE_BODY_ONLY}`;

  await deps.publish(EdgeObserved, {
    source: TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
    occurred_at: occurredAt,
    subject_id: edgeSubjectId,
    payload: {
      from_id: payload.record_id,
      to_id: topicId,
      type: 'discusses',
      source: TOPIC_DISCOVERY_SOURCE_BODY_ONLY,
      confidence: confidenceFromDistance(distance, threshold),
      weight: 1.0,
      valid_from: occurredAt,
      valid_to: null,
    },
    evidence: {
      cluster_distance: distance,
      embedding_id: embeddingId,
      strategy: STRATEGY_BODY_ONLY,
    },
    causation_id: ctx.envelope.event_id,
  });
}
