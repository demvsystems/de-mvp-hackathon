import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@repo/db';
import type { EventEnvelope, MessageContext } from '@repo/messaging';
import { handleEdgeObserved, handleRecordDeleted, handleRecordObserved } from '../src/handlers';

const live = process.env['MATERIALIZER_TEST_LIVE'] === '1';

interface EnvelopeOverrides {
  occurred_at?: string;
  observed_at?: string;
  evidence?: unknown;
}

function ctx(overrides: EnvelopeOverrides = {}): MessageContext {
  const t = overrides.occurred_at ?? '2026-04-28T10:00:00.000Z';
  const envelope: EventEnvelope = {
    event_id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    event_type: 'record.observed',
    schema_version: 1,
    occurred_at: t,
    observed_at: overrides.observed_at ?? t,
    source: 'slack',
    source_event_id: null,
    subject_kind: 'record',
    subject_id: 'rec:test',
    payload: {},
    evidence: overrides.evidence ?? null,
    causation_id: null,
    correlation_id: null,
  };
  return { envelope, seq: 1, deliveryCount: 1 };
}

function makeRecord(overrides: { id?: string; body?: string; updated_at?: string } = {}) {
  return {
    id: overrides.id ?? 'rec:test:1',
    type: 'message',
    source: 'slack',
    title: null,
    body: overrides.body ?? 'original body',
    payload: { foo: 'bar' },
    created_at: '2026-04-28T09:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-28T09:00:00.000Z',
  };
}

function makeEdge(overrides: { confidence?: number; weight?: number; valid_from?: string } = {}) {
  return {
    from_id: 'rec:test:1',
    to_id: 'rec:test:channel',
    type: 'posted_in',
    source: 'slack:v1',
    confidence: overrides.confidence ?? 1.0,
    weight: overrides.weight ?? 1.0,
    valid_from: overrides.valid_from ?? '2026-04-28T09:00:00.000Z',
    valid_to: null,
  };
}

describe.skipIf(!live)('materializer handlers', () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE records, edges RESTART IDENTITY`;
  });

  it('record.observed: LWW-Update — späterer updated_at überschreibt Body', async () => {
    const earlier = makeRecord({ body: 'first', updated_at: '2026-04-28T09:00:00.000Z' });
    const later = makeRecord({ body: 'second', updated_at: '2026-04-28T09:05:00.000Z' });

    await handleRecordObserved(earlier, ctx());
    await handleRecordObserved(later, ctx({ occurred_at: '2026-04-28T09:05:00.000Z' }));

    const rows = await sql<{ body: string }[]>`SELECT body FROM records WHERE id = ${earlier.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('second');

    // Reverse-Order: älteres Update darf den neueren Stand NICHT überschreiben
    await handleRecordObserved(earlier, ctx());
    const after = await sql<{ body: string }[]>`SELECT body FROM records WHERE id = ${earlier.id}`;
    expect(after[0]!.body).toBe('second');
  });

  it('record.deleted: setzt is_deleted=true und invalidiert alle inzidenten offenen Edges', async () => {
    await handleRecordObserved(makeRecord(), ctx());
    await handleEdgeObserved(makeEdge(), ctx());
    // Zweite Edge in Gegenrichtung — beide müssen via from_id ODER to_id getroffen werden
    await handleEdgeObserved(
      { ...makeEdge(), from_id: 'rec:test:other', to_id: 'rec:test:1', type: 'replies_to' },
      ctx(),
    );

    const deletedAt = '2026-04-28T11:00:00.000Z';
    await handleRecordDeleted({ id: 'rec:test:1' }, ctx({ occurred_at: deletedAt }));

    const records = await sql<
      { is_deleted: boolean }[]
    >`SELECT is_deleted FROM records WHERE id = ${'rec:test:1'}`;
    expect(records[0]!.is_deleted).toBe(true);

    const edges = await sql<{ valid_to: Date | null }[]>`SELECT valid_to FROM edges`;
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.valid_to).not.toBeNull();
    }
  });

  it('edge.observed: identisches Tupel triggert Upsert mit neueren Werten — kein Constraint-Crash', async () => {
    await handleEdgeObserved(
      makeEdge({ confidence: 0.5, weight: 1.0 }),
      ctx({ occurred_at: '2026-04-28T09:00:00.000Z' }),
    );
    // Zweiter Insert muss strikt späteres observed_at haben — Materializer-LWW
    // greift nur bei `edges.observed_at <= EXCLUDED.observed_at`.
    await handleEdgeObserved(
      makeEdge({ confidence: 0.9, weight: 2.0 }),
      ctx({ occurred_at: '2026-04-28T09:10:00.000Z' }),
    );

    const rows = await sql<{ confidence: number; weight: number }[]>`
      SELECT confidence, weight FROM edges
      WHERE from_id = ${'rec:test:1'} AND to_id = ${'rec:test:channel'}
        AND type = ${'posted_in'} AND source = ${'slack:v1'}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confidence).toBeCloseTo(0.9);
    expect(rows[0]!.weight).toBeCloseTo(2.0);
  });
});
