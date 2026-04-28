import { describe, expect, it, vi } from 'vitest';
import type { MessageContext, RecordPayload } from '@repo/messaging';
import { PendingMentions } from './pending';
import { processNewJiraIssue, processRecord } from './processor';
import type { ResolverDeps } from './resolver';

function mockDeps(
  rows: Array<{ id: string; source: string; key?: string; channel?: string }>,
): ResolverDeps {
  return {
    queryJiraIssueByKey: vi.fn(async (key: string) => {
      const found = rows.find((r) => r.source === 'jira' && r.key === key);
      return found ? { id: found.id } : null;
    }),
    queryChannelById: vi.fn(async (channel: string) => {
      const found = rows.find((r) => r.source === 'slack' && r.channel === channel);
      return found ? { id: found.id } : null;
    }),
  };
}

function slackMessage(body: string): RecordPayload {
  return {
    id: 'slack:msg:hackathon/C1/123.456',
    type: 'message',
    source: 'slack',
    title: null,
    body,
    payload: {},
    created_at: '2026-04-15T10:00:00.000Z',
    updated_at: '2026-04-15T10:00:00.000Z',
  };
}

function jiraIssue(key: string): RecordPayload {
  return {
    id: `jira:issue:${key}`,
    type: 'issue',
    source: 'jira',
    title: 'foo',
    body: 'bar',
    payload: { key },
    created_at: '2026-04-15T10:00:00.000Z',
    updated_at: '2026-04-15T10:00:00.000Z',
  };
}

function ctx(eventId = 'evt_a'): MessageContext {
  return {
    envelope: {
      event_id: eventId,
      event_type: 'record.observed',
      schema_version: 1,
      occurred_at: '2026-04-15T10:00:00.000Z',
      observed_at: '2026-04-15T10:00:00.500Z',
      source: 'slack',
      source_event_id: null,
      subject_kind: 'record',
      subject_id: 'slack:msg:hackathon/C1/123.456',
      payload: {},
      evidence: null,
      causation_id: null,
      correlation_id: null,
    },
    seq: 1,
  } as MessageContext;
}

describe('processRecord', () => {
  it('emits an edge when a jira-key resolves to an ingested issue', async () => {
    const deps = mockDeps([{ id: 'jira:issue:DEMV-4127', source: 'jira', key: 'DEMV-4127' }]);
    const pending = new PendingMentions();
    const publish = vi
      .fn()
      .mockResolvedValue({ event_id: 'evt_b', seq: 1, stream: 'EVENTS', duplicate: false });

    await processRecord(slackMessage('Bitte zu DEMV-4127 gucken.'), ctx(), deps, pending, publish);

    expect(publish).toHaveBeenCalledTimes(1);
    const call = publish.mock.calls[0]!;
    expect(call[1].payload.from_id).toBe('slack:msg:hackathon/C1/123.456');
    expect(call[1].payload.to_id).toBe('jira:issue:DEMV-4127');
    expect(pending.size()).toBe(0);
  });

  it('queues a jira-key in pending when target is not yet ingested', async () => {
    const deps = mockDeps([]);
    const pending = new PendingMentions();
    const publish = vi.fn();

    await processRecord(slackMessage('Wo bleibt DEMV-9999?'), ctx(), deps, pending, publish);

    expect(publish).not.toHaveBeenCalled();
    expect(pending.size()).toBe(1);
  });

  it('emits directly for URL-based patterns without touching the resolver', async () => {
    const deps = mockDeps([]);
    const pending = new PendingMentions();
    const publish = vi
      .fn()
      .mockResolvedValue({ event_id: 'evt_b', seq: 1, stream: 'EVENTS', duplicate: false });

    await processRecord(
      slackMessage('Siehe https://github.com/foo/bar/pull/12'),
      ctx(),
      deps,
      pending,
      publish,
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![1].payload.to_id).toBe('github:pr:foo/bar/12');
    expect(deps.queryJiraIssueByKey).not.toHaveBeenCalled();
  });

  it('skips container-record types', async () => {
    const channel: RecordPayload = { ...slackMessage('mit DEMV-4127'), type: 'channel' };
    const publish = vi.fn();
    await processRecord(channel, ctx(), mockDeps([]), new PendingMentions(), publish);
    expect(publish).not.toHaveBeenCalled();
  });

  it('skips records without a body', async () => {
    const noBody: RecordPayload = { ...slackMessage(''), body: null };
    const publish = vi.fn();
    await processRecord(noBody, ctx(), mockDeps([]), new PendingMentions(), publish);
    expect(publish).not.toHaveBeenCalled();
  });

  it('handles multiple matches in one body', async () => {
    const deps = mockDeps([
      { id: 'jira:issue:DEMV-4127', source: 'jira', key: 'DEMV-4127' },
      { id: 'jira:issue:SHOP-1', source: 'jira', key: 'SHOP-1' },
    ]);
    const pending = new PendingMentions();
    const publish = vi
      .fn()
      .mockResolvedValue({ event_id: 'evt_b', seq: 1, stream: 'EVENTS', duplicate: false });
    await processRecord(
      slackMessage('SHOP-1 hängt mit DEMV-4127 zusammen.'),
      ctx(),
      deps,
      pending,
      publish,
    );
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe('processNewJiraIssue', () => {
  it('drains pending mentions for the issue key and emits edges', async () => {
    const pending = new PendingMentions();
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', {
      patternName: 'jira_key',
      confidence: 0.95,
      matchText: 'DEMV-9999',
      matchStart: 0,
      matchEnd: 9,
      matchGroups: ['DEMV-9999', 'DEMV', '9999'],
    });
    pending.addJiraKey('DEMV-9999', 'slack:msg:B', {
      patternName: 'jira_key',
      confidence: 0.95,
      matchText: 'DEMV-9999',
      matchStart: 5,
      matchEnd: 14,
      matchGroups: ['DEMV-9999', 'DEMV', '9999'],
    });
    const publish = vi
      .fn()
      .mockResolvedValue({ event_id: 'evt_b', seq: 1, stream: 'EVENTS', duplicate: false });

    await processNewJiraIssue(jiraIssue('DEMV-9999'), ctx(), pending, publish);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(pending.size()).toBe(0);
  });

  it('is a no-op when no pending mentions match the new issue', async () => {
    const pending = new PendingMentions();
    const publish = vi.fn();
    await processNewJiraIssue(jiraIssue('NEW-1'), ctx(), pending, publish);
    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores non-jira-issue records', async () => {
    const pending = new PendingMentions();
    const publish = vi.fn();
    await processNewJiraIssue(slackMessage('text'), ctx(), pending, publish);
    expect(publish).not.toHaveBeenCalled();
  });
});
