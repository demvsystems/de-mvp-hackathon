import { randomUUID } from 'node:crypto';
import { publishWithPersist } from '@repo/materializer';
import {
  EdgeObserved,
  TopicCreated,
  TopicUpdated,
  type EmbeddingCreatedPayload,
  type MessageContext,
} from '@repo/messaging';
import {
  DISTANCE_THRESHOLD,
  STRATEGY_WITH_NEIGHBORS,
  TOPIC_DISCOVERY_SOURCE,
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
  isAlreadyMember(recordId: string, topicId: string): Promise<boolean>;
  publishWithPersist: typeof publishWithPersist;
  recomputeTopicActivity(topicId: string): Promise<void>;
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
  if (parseStrategy(payload.model_version) !== STRATEGY_WITH_NEIGHBORS) return;

  const vectorLit = vectorLiteral(payload.vector);
  const occurredAt = new Date().toISOString();
  const threshold = DISTANCE_THRESHOLD;

  const nearest = await deps.findNearestActiveTopic(vectorLit);

  let topicId: string;
  let distance: number;

  if (nearest && nearest.distance <= threshold) {
    // Re-embeds (triggered by structural-edge events) re-emit EmbeddingCreated
    // for records that are already topic members. Without this guard the
    // member_count would inflate by one per re-embed, while the discusses-edge
    // unique constraint silently dedupes the edge itself.
    if (await deps.isAlreadyMember(payload.record_id, nearest.id)) return;

    topicId = nearest.id;
    distance = nearest.distance;

    const newCentroid = incrementalMean(nearest.centroid, nearest.memberCount, payload.vector);
    const newMemberCount = nearest.memberCount + 1;

    await deps.publishWithPersist(TopicUpdated, {
      source: TOPIC_DISCOVERY_SOURCE,
      occurred_at: occurredAt,
      subject_id: topicId,
      payload: {
        id: topicId,
        label: null,
        description: null,
        centroid: newCentroid,
        member_count: newMemberCount,
      },
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
    });
  } else {
    topicId = `topic:${randomUUID()}`;
    distance = 0;

    await deps.publishWithPersist(TopicCreated, {
      source: TOPIC_DISCOVERY_SOURCE,
      occurred_at: occurredAt,
      subject_id: topicId,
      payload: {
        id: topicId,
        status: 'active',
        discovered_by: TOPIC_DISCOVERY_SOURCE,
        initial_centroid_summary: {
          sample_record_ids: [payload.record_id],
          cluster_size: 1,
          intra_cluster_distance_avg: 0,
        },
        centroid: [...payload.vector],
        member_count: 1,
      },
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
    });
  }

  const embeddingId = `embedding:${payload.record_id}:${payload.chunk_idx}:${payload.model_version}`;
  const edgeSubjectId = `edge:discusses:${payload.record_id}->${topicId}:${TOPIC_DISCOVERY_SOURCE}`;

  await deps.publishWithPersist(EdgeObserved, {
    source: TOPIC_DISCOVERY_SOURCE,
    occurred_at: occurredAt,
    subject_id: edgeSubjectId,
    payload: {
      from_id: payload.record_id,
      to_id: topicId,
      type: 'discusses',
      source: TOPIC_DISCOVERY_SOURCE,
      confidence: confidenceFromDistance(distance, threshold),
      weight: 1.0,
      valid_from: occurredAt,
      valid_to: null,
    },
    evidence: {
      cluster_distance: distance,
      embedding_id: embeddingId,
      strategy: STRATEGY_WITH_NEIGHBORS,
    },
    causation_id: ctx.envelope.event_id,
  });

  try {
    await deps.recomputeTopicActivity(topicId);
  } catch (err) {
    // Activity-Recompute darf die Clustering-Entscheidung nicht blockieren —
    // der discusses-Edge ist persistiert und Source of Truth. Nächster
    // Recompute auf demselben Topic holt die Metriken nach.
    console.error('[topic-discovery] recomputeTopicActivity failed', { topicId, err });
  }
}
