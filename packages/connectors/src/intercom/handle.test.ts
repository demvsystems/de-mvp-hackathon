import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission, type Emission } from '../core';
import { map } from './handle';
import { agentId, contactId, conversationId } from './ids';

const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

function findEmission(
  emissions: Emission[],
  predicate: (e: Emission) => boolean,
): Emission | undefined {
  return emissions.find(predicate);
}

const FIXTURE = {
  conversations: [
    {
      id: 'conv-1',
      created_at: '2026-04-15T10:00:00Z',
      updated_at: '2026-04-15T10:30:00Z',
      state: 'open',
      subject: 'Login geht nicht',
      contact: { type: 'user', id: 'cust-42', name: 'Anna' },
      assignee_id: 'agent-1',
      tags: ['login'],
      parts: [
        {
          id: 'p1',
          part_type: 'comment',
          body: 'Ich kann mich nicht einloggen.',
          created_at: '2026-04-15T10:00:00Z',
          author: { type: 'user', id: 'cust-42', name: 'Anna' },
        },
        {
          id: 'p2',
          part_type: 'comment',
          body: 'Wir schauen uns das an.',
          created_at: '2026-04-15T10:15:00Z',
          author: { type: 'admin', id: 'agent-1', name: 'Bob' },
        },
      ],
    },
  ],
  contacts: [{ id: 'cust-42', name: 'Anna', email: 'anna@example.com' }],
  agents: [{ id: 'agent-1', name: 'Bob' }],
};

describe('intercom mapper', () => {
  it('mapt eine Conversation mit Parts auf Records und Edges', () => {
    const { emissions } = map(FIXTURE);

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    expect(records).toHaveLength(5);
    expect(edges).toHaveLength(2 + 4);

    expect(
      edges.find((e) => e.subject_id.startsWith('edge:assigned_to:intercom:conversation:conv-1')),
    ).toBeDefined();
  });
});

describe('intercom mapper — Vertrag', () => {
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

describe('intercom mapper — Lifecycle', () => {
  it('ein State-Update erzeugt observed (alter State) plus updated (neuer State)', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-lc',
          created_at: '2026-04-15T10:00:00Z',
          updated_at: '2026-04-15T11:00:00Z',
          state: 'closed',
          contact: { type: 'user', id: 'cust-1' },
          parts: [],
          updates: [{ at: '2026-04-15T11:00:00Z', previous: { state: 'open' } }],
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [],
    };

    const { emissions } = map(fixture);
    const subjectId = conversationId('conv-lc');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;

    expect((observed.payload as { payload: { state: string } }).payload.state).toBe('open');
    expect((updated.payload as { payload: { state: string } }).payload.state).toBe('closed');
    expect((updated.payload as { updated_at: string }).updated_at).toBe('2026-04-15T11:00:00Z');
  });

  it('mehrere Updates ergeben observed plus chronologische update-kette', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-multi',
          created_at: '2026-04-15T09:00:00Z',
          updated_at: '2026-04-15T12:00:00Z',
          state: 'closed',
          contact: { type: 'user', id: 'cust-1' },
          parts: [],
          updates: [
            { at: '2026-04-15T10:00:00Z', previous: { state: 'open' } },
            { at: '2026-04-15T11:00:00Z', previous: { state: 'snoozed' } },
          ],
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [],
    };

    const { emissions } = map(fixture);
    const subjectId = conversationId('conv-multi');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updates = emissions.filter(
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    );

    expect((observed.payload as { payload: { state: string } }).payload.state).toBe('open');
    expect(updates).toHaveLength(2);
    expect((updates[0]!.payload as { payload: { state: string } }).payload.state).toBe('snoozed');
    expect((updates[1]!.payload as { payload: { state: string } }).payload.state).toBe('closed');
  });

  it('Re-Assignment wird als record.updated mit neuem assignee_id emittiert', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-reassign',
          created_at: '2026-04-15T09:00:00Z',
          updated_at: '2026-04-15T10:00:00Z',
          state: 'open',
          contact: { type: 'user', id: 'cust-1' },
          assignee_id: 'agent-2',
          parts: [],
          updates: [{ at: '2026-04-15T10:00:00Z', previous: { assignee_id: 'agent-1' } }],
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [
        { id: 'agent-1', name: 'Bob' },
        { id: 'agent-2', name: 'Carla' },
      ],
    };

    const { emissions } = map(fixture);
    const subjectId = conversationId('conv-reassign');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;

    expect(
      (observed.payload as { payload: { assignee_id: string | null } }).payload.assignee_id,
    ).toBe('agent-1');
    expect(
      (updated.payload as { payload: { assignee_id: string | null } }).payload.assignee_id,
    ).toBe('agent-2');
  });

  it('eine gelöschte Conversation erzeugt record.deleted', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-del',
          created_at: '2026-04-15T09:00:00Z',
          updated_at: '2026-04-15T10:00:00Z',
          state: 'closed',
          contact: { type: 'user', id: 'cust-1' },
          parts: [],
          deleted_at: '2026-04-16T08:00:00Z',
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [],
    };

    const { emissions } = map(fixture);
    const subjectId = conversationId('conv-del');

    const deleted = findEmission(
      emissions,
      (e) => e.event_type === 'record.deleted' && e.subject_id === subjectId,
    );
    expect(deleted).toBeDefined();
    expect(deleted!.payload).toEqual({ id: subjectId });
  });

  it('updated und deleted tragen causation_id aufs initiale observed', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-caus',
          created_at: '2026-04-15T09:00:00Z',
          updated_at: '2026-04-15T11:00:00Z',
          state: 'closed',
          contact: { type: 'user', id: 'cust-1' },
          parts: [],
          updates: [{ at: '2026-04-15T10:00:00Z', previous: { state: 'open' } }],
          deleted_at: '2026-04-16T10:00:00Z',
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [],
    };

    const { emissions } = map(fixture);
    const subjectId = conversationId('conv-caus');

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
      conversations: [
        {
          id: 'conv-contract',
          created_at: '2026-04-15T09:00:00Z',
          updated_at: '2026-04-15T11:00:00Z',
          state: 'closed',
          contact: { type: 'user', id: 'cust-1' },
          parts: [],
          updates: [{ at: '2026-04-15T10:00:00Z', previous: { state: 'open' } }],
          deleted_at: '2026-04-16T10:00:00Z',
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [],
    };
    const { emissions } = map(fixture);
    expect(() => assertContractValid(emissions)).not.toThrow();
  });
});

describe('intercom mapper — Korrelation', () => {
  it('Conversation-Cascade (Conversation + Parts + Edges) korreliert auf das Conversation-Subject', () => {
    const fixture = {
      conversations: [
        {
          id: 'conv-corr',
          created_at: '2026-04-15T10:00:00Z',
          updated_at: '2026-04-15T10:30:00Z',
          state: 'open',
          contact: { type: 'user', id: 'cust-1', name: 'Anna' },
          assignee_id: 'agent-1',
          parts: [
            {
              id: 'p1',
              part_type: 'comment',
              body: 'Hallo',
              created_at: '2026-04-15T10:00:00Z',
              author: { type: 'user', id: 'cust-1' },
            },
            {
              id: 'p2',
              part_type: 'comment',
              body: 'Wir helfen.',
              created_at: '2026-04-15T10:15:00Z',
              author: { type: 'admin', id: 'agent-1' },
            },
          ],
        },
      ],
      contacts: [{ id: 'cust-1' }],
      agents: [{ id: 'agent-1', name: 'Bob' }],
    };

    const { emissions } = map(fixture);
    const conv = conversationId('conv-corr');

    const conversationEvents = emissions.filter(
      (e) =>
        e.subject_id === conv ||
        e.subject_id.includes(':part:conv-corr/') ||
        e.subject_id.startsWith(`edge:authored_by:${conv}->`) ||
        e.subject_id.startsWith(`edge:assigned_to:${conv}->`) ||
        e.subject_id.startsWith('edge:posted_in:intercom:part:conv-corr/') ||
        e.subject_id.startsWith('edge:authored_by:intercom:part:conv-corr/'),
    );

    expect(conversationEvents.length).toBeGreaterThan(0);
    for (const e of conversationEvents) {
      expect(e.correlation_id, `${e.subject_id} fehlt correlation_id`).toBe(conv);
    }
  });

  it('Contact und Agent Records korrelieren nicht (eigenständige Akteure)', () => {
    const fixture = {
      conversations: [],
      contacts: [{ id: 'cust-7', name: 'Eve' }],
      agents: [{ id: 'agent-9', name: 'Frank' }],
    };

    const { emissions } = map(fixture);
    const contact = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === contactId('cust-7'),
    )!;
    const agent = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === agentId('agent-9'),
    )!;

    expect(contact.correlation_id).toBeNull();
    expect(agent.correlation_id).toBeNull();
  });
});

describe('intercom mapper — Idempotenz', () => {
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
