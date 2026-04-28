import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission } from '../core';
import { map } from './handle';

const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

const FIXTURE = {
  boards: [{ id: 'b1', name: 'Feature-Wünsche', slug: 'features' }],
  users: [
    { id: 'u1', name: 'Anna' },
    { id: 'u2', name: 'Bob' },
  ],
  posts: [
    {
      id: 'p1',
      title: 'Dark Mode',
      body: 'Bitte einen Dark Mode hinzufügen.',
      status: 'planned',
      board_id: 'b1',
      author_id: 'u1',
      created_at: '2026-04-15T08:00:00Z',
      vote_count: 12,
      voter_ids: ['u1', 'u2'],
      comments: [
        {
          id: 'c1',
          body: 'Brauche ich auch.',
          created_at: '2026-04-15T08:30:00Z',
          author_id: 'u2',
        },
      ],
    },
  ],
};

describe('upvoty mapper', () => {
  it('mapt einen Post mit Comment auf Records und Edges', () => {
    const { emissions } = map(FIXTURE);

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    expect(records).toHaveLength(5);
    expect(edges).toHaveLength(4);

    expect(
      edges.find((e) => e.subject_id.startsWith('edge:commented_on:upvoty:comment:p1/c1')),
    ).toBeDefined();
  });
});

describe('upvoty mapper — Vertrag', () => {
  it('alle Emissions validieren gegen ihre @repo/messaging-Schemas', () => {
    const { emissions } = map(FIXTURE);
    expect(() => assertContractValid(emissions)).not.toThrow();
  });

  it('alle Edge-Emissions tragen causation_id auf das Record-Event', () => {
    const { emissions } = map(FIXTURE);
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.causation_id, `${e.subject_id} fehlt causation_id`).not.toBeNull();
    }
  });
});

describe('upvoty mapper — Idempotenz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('zwei Aufrufe mit gleichem Input liefern identische Emissions', () => {
    const first = map(FIXTURE).emissions.map(serializeEmission);
    const second = map(FIXTURE).emissions.map(serializeEmission);
    expect(second).toEqual(first);
  });
});
