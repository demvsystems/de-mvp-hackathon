import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingCreatedPayload, MessageContext } from '@repo/messaging';
import { discoverTopic, type DiscoveryDeps, type NearestTopicState } from './discover';
import { DISTANCE_THRESHOLD, TOPIC_DISCOVERY_SOURCE } from './cluster';

const TRIGGER_EVENT_ID = 'evt_emb_a1b2c3';

function makePayload(overrides: Partial<EmbeddingCreatedPayload> = {}): EmbeddingCreatedPayload {
  return {
    record_id: 'slack:msg:T01ABC/C02DEF/1714028591.012345',
    chunk_idx: 0,
    chunk_text: 'BiPro 430.4 ist heute kaputt',
    model_version: 'openai-small-3:with-neighbors:v1',
    vector: [0.1, -0.2, 0.3],
    generated_at: '2026-04-15T10:42:33.000Z',
    ...overrides,
  };
}

function makeCtx(): MessageContext {
  return {
    envelope: {
      event_id: TRIGGER_EVENT_ID,
      event_type: 'embedding.created',
      schema_version: 1,
      occurred_at: '2026-04-15T10:42:33.000Z',
      observed_at: '2026-04-15T10:42:34.000Z',
      source: 'embedder:v1',
      source_event_id: null,
      subject_kind: 'embedding',
      subject_id:
        'embedding:slack:msg:T01ABC/C02DEF/1714028591.012345:0:openai-small-3:with-neighbors:v1',
      payload: {},
      evidence: null,
      causation_id: null,
      correlation_id: null,
    },
    seq: 42,
    deliveryCount: 1,
  };
}

interface PublishCall {
  event_type: string;
  input: {
    source: string;
    subject_id: string;
    payload: unknown;
    causation_id?: string;
    evidence?: unknown;
  };
}

function makeDeps(overrides: Partial<DiscoveryDeps> = {}): {
  deps: DiscoveryDeps;
  calls: {
    findNearestActiveTopic: ReturnType<typeof vi.fn>;
    isAlreadyMember: ReturnType<typeof vi.fn>;
    publishWithPersist: ReturnType<typeof vi.fn>;
    published: PublishCall[];
  };
} {
  const published: PublishCall[] = [];
  const calls = {
    findNearestActiveTopic: vi.fn(async (): Promise<NearestTopicState | null> => null),
    isAlreadyMember: vi.fn(async (): Promise<boolean> => false),
    publishWithPersist: vi.fn(async (event: { event_type: string }, input: unknown) => {
      published.push({ event_type: event.event_type, input: input as PublishCall['input'] });
      return { event_id: 'evt_fake', seq: 1, stream: 'EVENTS', duplicate: false };
    }),
    published,
  };

  const deps: DiscoveryDeps = {
    findNearestActiveTopic: overrides.findNearestActiveTopic ?? calls.findNearestActiveTopic,
    isAlreadyMember: overrides.isAlreadyMember ?? calls.isAlreadyMember,
    publishWithPersist: (overrides.publishWithPersist ??
      calls.publishWithPersist) as DiscoveryDeps['publishWithPersist'],
  };
  return { deps, calls };
}

describe('discoverTopic — strategy gate', () => {
  it('skips non-with-neighbors strategies (no DB or publish calls)', async () => {
    const { deps, calls } = makeDeps();
    await discoverTopic(
      makePayload({ model_version: 'openai-small-3:body-only:v1' }),
      makeCtx(),
      deps,
    );
    expect(calls.findNearestActiveTopic).not.toHaveBeenCalled();
    expect(calls.publishWithPersist).not.toHaveBeenCalled();
  });
});

describe('discoverTopic — no nearest topic', () => {
  it('publishes topic.created with initial centroid + member_count=1, then discusses edge with confidence 1', async () => {
    const { deps, calls } = makeDeps();
    const payload = makePayload();
    await discoverTopic(payload, makeCtx(), deps);

    expect(calls.findNearestActiveTopic).toHaveBeenCalledTimes(1);
    expect(calls.published).toHaveLength(2);

    const [topicEvt, edgeEvt] = calls.published;
    expect(topicEvt?.event_type).toBe('topic.created');
    expect(topicEvt?.input.source).toBe(TOPIC_DISCOVERY_SOURCE);
    expect(topicEvt?.input.causation_id).toBe(TRIGGER_EVENT_ID);

    const topicPayload = topicEvt?.input.payload as {
      id: string;
      status: string;
      centroid: number[];
      member_count: number;
    };
    expect(topicPayload.id).toMatch(/^topic:[0-9a-f-]+$/);
    expect(topicPayload.status).toBe('active');
    expect(topicPayload.centroid).toEqual(payload.vector);
    expect(topicPayload.member_count).toBe(1);

    expect(edgeEvt?.event_type).toBe('edge.observed');
    const edgePayload = edgeEvt?.input.payload as {
      type: string;
      from_id: string;
      to_id: string;
      confidence: number;
    };
    expect(edgePayload.type).toBe('discusses');
    expect(edgePayload.from_id).toBe(payload.record_id);
    expect(edgePayload.to_id).toBe(topicPayload.id);
    expect(edgePayload.confidence).toBe(1);

    const evidence = edgeEvt?.input.evidence as { cluster_distance: number; strategy: string };
    expect(evidence.cluster_distance).toBe(0);
    expect(evidence.strategy).toBe('with-neighbors');
  });
});

describe('discoverTopic — nearest beyond threshold', () => {
  it('also publishes topic.created when nearest distance exceeds threshold', async () => {
    const { deps, calls } = makeDeps({
      findNearestActiveTopic: vi.fn(
        async (): Promise<NearestTopicState | null> => ({
          id: 'topic:far-away',
          distance: DISTANCE_THRESHOLD + 0.05,
          centroid: [0.9, 0.9, 0.9],
          memberCount: 5,
        }),
      ),
    });

    await discoverTopic(makePayload(), makeCtx(), deps);

    expect(calls.published.map((p) => p.event_type)).toEqual(['topic.created', 'edge.observed']);
    const edgePayload = calls.published[1]?.input.payload as { to_id: string; confidence: number };
    expect(edgePayload.to_id).not.toBe('topic:far-away');
    expect(edgePayload.confidence).toBe(1);
  });
});

describe('discoverTopic — nearest within threshold', () => {
  it('publishes topic.updated with incrementally recomputed centroid + member_count, plus discusses edge', async () => {
    const distance = 0.15;
    const expectedConfidence = 1 - distance / DISTANCE_THRESHOLD;
    const existingCentroid = [0.0, 0.0, 0.0];
    const existingMemberCount = 1;

    const { deps, calls } = makeDeps({
      findNearestActiveTopic: vi.fn(
        async (): Promise<NearestTopicState | null> => ({
          id: 'topic:7c8d9e1f-2a3b-existing',
          distance,
          centroid: existingCentroid,
          memberCount: existingMemberCount,
        }),
      ),
    });

    const payload = makePayload();
    await discoverTopic(payload, makeCtx(), deps);

    expect(calls.published).toHaveLength(2);
    const [updateEvt, edgeEvt] = calls.published;

    expect(updateEvt?.event_type).toBe('topic.updated');
    const updatePayload = updateEvt?.input.payload as {
      id: string;
      centroid: number[];
      member_count: number;
      label: string | null;
      description: string | null;
    };
    expect(updatePayload.id).toBe('topic:7c8d9e1f-2a3b-existing');
    expect(updatePayload.label).toBeNull();
    expect(updatePayload.description).toBeNull();
    expect(updatePayload.member_count).toBe(existingMemberCount + 1);
    // (existing*1 + new) / 2 == new/2
    expect(updatePayload.centroid).toEqual(payload.vector.map((v) => v / 2));
    expect(updateEvt?.input.causation_id).toBe(TRIGGER_EVENT_ID);

    expect(edgeEvt?.event_type).toBe('edge.observed');
    const edgePayload = edgeEvt?.input.payload as {
      to_id: string;
      confidence: number;
      type: string;
    };
    expect(edgePayload.to_id).toBe('topic:7c8d9e1f-2a3b-existing');
    expect(edgePayload.confidence).toBeCloseTo(expectedConfidence, 10);
    expect(edgePayload.type).toBe('discusses');
    expect(edgeEvt?.input.causation_id).toBe(TRIGGER_EVENT_ID);
  });

  it('confidence is 0 at exactly the threshold', async () => {
    const { deps, calls } = makeDeps({
      findNearestActiveTopic: vi.fn(
        async (): Promise<NearestTopicState | null> => ({
          id: 'topic:edge',
          distance: DISTANCE_THRESHOLD,
          centroid: [0, 0, 0],
          memberCount: 3,
        }),
      ),
    });

    await discoverTopic(makePayload(), makeCtx(), deps);

    const events = calls.published.map((p) => p.event_type);
    expect(events).toEqual(['topic.updated', 'edge.observed']);
    const edgePayload = calls.published[1]?.input.payload as { confidence: number };
    expect(edgePayload.confidence).toBe(0);
  });
});

describe('discoverTopic — re-embed idempotency', () => {
  it('skips publish entirely when the record is already a member of the nearest topic', async () => {
    const isAlreadyMember = vi.fn(async () => true);
    const { deps, calls } = makeDeps({
      findNearestActiveTopic: vi.fn(
        async (): Promise<NearestTopicState | null> => ({
          id: 'topic:already-member',
          distance: 0.05,
          centroid: [0.1, -0.2, 0.3],
          memberCount: 4,
        }),
      ),
      isAlreadyMember,
    });

    await discoverTopic(makePayload(), makeCtx(), deps);

    expect(isAlreadyMember).toHaveBeenCalledTimes(1);
    expect(isAlreadyMember).toHaveBeenCalledWith(
      'slack:msg:T01ABC/C02DEF/1714028591.012345',
      'topic:already-member',
    );
    expect(calls.published).toHaveLength(0);
  });
});

describe('discoverTopic — causation propagation', () => {
  it('every published event carries causation_id == ctx.envelope.event_id', async () => {
    const { deps, calls } = makeDeps();
    await discoverTopic(makePayload(), makeCtx(), deps);
    for (const evt of calls.published) {
      expect(evt.input.causation_id).toBe(TRIGGER_EVENT_ID);
    }
  });
});
