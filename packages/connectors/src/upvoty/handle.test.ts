import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission, type Emission } from '../core';
import { map } from './handle';
import { boardId, postId, userId } from './ids';

const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

function findEmission(
  emissions: Emission[],
  predicate: (e: Emission) => boolean,
): Emission | undefined {
  return emissions.find(predicate);
}

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

describe('upvoty mapper — Lifecycle', () => {
  it('ein Status-Update erzeugt observed (alter Status) plus updated (neuer Status)', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [{ id: 'u1', name: 'Anna' }],
      posts: [
        {
          id: 'p-lc',
          title: 'SSO Login',
          body: 'Bitte SSO einbauen.',
          status: 'planned',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-15T08:00:00Z',
          vote_count: 5,
          voter_ids: [],
          comments: [],
          updates: [{ at: '2026-04-20T09:00:00Z', previous: { status: 'open' } }],
        },
      ],
    };

    const { emissions } = map(fixture);
    const subjectId = postId('p-lc');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;

    expect((observed.payload as { payload: { status: string } }).payload.status).toBe('open');
    expect((updated.payload as { payload: { status: string } }).payload.status).toBe('planned');
    expect((updated.payload as { updated_at: string }).updated_at).toBe('2026-04-20T09:00:00Z');
  });

  it('mehrere Updates ergeben observed plus chronologische update-kette', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [{ id: 'u1', name: 'Anna' }],
      posts: [
        {
          id: 'p-multi',
          title: 'Mobile App',
          body: 'Mobile-Variante bauen.',
          status: 'completed',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-10T08:00:00Z',
          vote_count: 0,
          voter_ids: [],
          comments: [],
          updates: [
            { at: '2026-04-15T09:00:00Z', previous: { status: 'open' } },
            { at: '2026-04-20T09:00:00Z', previous: { status: 'planned' } },
            { at: '2026-04-25T09:00:00Z', previous: { status: 'in_progress' } },
          ],
        },
      ],
    };

    const { emissions } = map(fixture);
    const subjectId = postId('p-multi');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updates = emissions.filter(
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    );

    expect((observed.payload as { payload: { status: string } }).payload.status).toBe('open');
    expect(updates).toHaveLength(3);
    expect((updates[0]!.payload as { payload: { status: string } }).payload.status).toBe('planned');
    expect((updates[1]!.payload as { payload: { status: string } }).payload.status).toBe(
      'in_progress',
    );
    expect((updates[2]!.payload as { payload: { status: string } }).payload.status).toBe(
      'completed',
    );
  });

  it('ein gelöschter Post erzeugt record.deleted', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [{ id: 'u1', name: 'Anna' }],
      posts: [
        {
          id: 'p-del',
          title: 'Falsch eingestellt',
          body: 'Bitte ignorieren.',
          status: 'closed',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-15T08:00:00Z',
          vote_count: 0,
          voter_ids: [],
          comments: [],
          deleted_at: '2026-04-16T08:00:00Z',
        },
      ],
    };

    const { emissions } = map(fixture);
    const subjectId = postId('p-del');

    const deleted = findEmission(
      emissions,
      (e) => e.event_type === 'record.deleted' && e.subject_id === subjectId,
    );
    expect(deleted).toBeDefined();
    expect(deleted!.payload).toEqual({ id: subjectId });
  });

  it('updated und deleted tragen causation_id aufs initiale observed', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [{ id: 'u1', name: 'Anna' }],
      posts: [
        {
          id: 'p-caus',
          title: 'X',
          body: 'Y',
          status: 'completed',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-10T08:00:00Z',
          vote_count: 0,
          voter_ids: [],
          comments: [],
          updates: [{ at: '2026-04-15T09:00:00Z', previous: { status: 'open' } }],
          deleted_at: '2026-04-20T09:00:00Z',
        },
      ],
    };

    const { emissions } = map(fixture);
    const subjectId = postId('p-caus');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;
    const deleted = findEmission(
      emissions,
      (e) => e.event_type === 'record.deleted' && e.subject_id === subjectId,
    )!;

    expect(observed.causation_id).toBeNull();
    expect(updated.causation_id).not.toBeNull();
    expect(deleted.causation_id).not.toBeNull();
    expect(updated.causation_id).toBe(deleted.causation_id);
  });

  it('Lifecycle-Emissions validieren gegen die @repo/messaging-Schemas', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [{ id: 'u1', name: 'Anna' }],
      posts: [
        {
          id: 'p-contract',
          title: 'X',
          body: 'Y',
          status: 'completed',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-10T08:00:00Z',
          vote_count: 0,
          voter_ids: [],
          comments: [],
          updates: [{ at: '2026-04-15T09:00:00Z', previous: { status: 'open' } }],
          deleted_at: '2026-04-20T09:00:00Z',
        },
      ],
    };
    const { emissions } = map(fixture);
    expect(() => assertContractValid(emissions)).not.toThrow();
  });
});

describe('upvoty mapper — Korrelation', () => {
  it('Post-Cascade (Post + Comments + Edges) korreliert auf das Post-Subject', () => {
    const fixture = {
      boards: [{ id: 'b1', name: 'Wünsche' }],
      users: [
        { id: 'u1', name: 'Anna' },
        { id: 'u2', name: 'Bob' },
      ],
      posts: [
        {
          id: 'p-corr',
          title: 'Feature',
          body: 'Bitte X',
          status: 'open',
          board_id: 'b1',
          author_id: 'u1',
          created_at: '2026-04-15T08:00:00Z',
          vote_count: 1,
          voter_ids: ['u2'],
          comments: [
            {
              id: 'c1',
              body: '+1',
              created_at: '2026-04-15T09:00:00Z',
              author_id: 'u2',
            },
          ],
        },
      ],
    };

    const { emissions } = map(fixture);
    const post = postId('p-corr');

    const postCascade = emissions.filter(
      (e) =>
        e.subject_id === post ||
        e.subject_id.includes(':comment:p-corr/') ||
        e.subject_id.startsWith(`edge:authored_by:${post}->`) ||
        e.subject_id.startsWith(`edge:posted_in:${post}->`) ||
        e.subject_id.startsWith('edge:commented_on:upvoty:comment:p-corr/') ||
        e.subject_id.startsWith('edge:authored_by:upvoty:comment:p-corr/'),
    );

    expect(postCascade.length).toBeGreaterThan(0);
    for (const e of postCascade) {
      expect(e.correlation_id, `${e.subject_id} fehlt correlation_id`).toBe(post);
    }
  });

  it('Board und User Records korrelieren nicht (eigenständige strukturelle Container)', () => {
    const fixture = {
      boards: [{ id: 'b9', name: 'X' }],
      users: [{ id: 'u9', name: 'Y' }],
      posts: [],
    };

    const { emissions } = map(fixture);
    const board = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === boardId('b9'),
    )!;
    const user = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === userId('u9'),
    )!;

    expect(board.correlation_id).toBeNull();
    expect(user.correlation_id).toBeNull();
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
