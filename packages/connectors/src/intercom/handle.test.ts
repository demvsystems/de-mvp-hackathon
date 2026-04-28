import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission } from '../core';
import { map } from './handle';

const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

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
