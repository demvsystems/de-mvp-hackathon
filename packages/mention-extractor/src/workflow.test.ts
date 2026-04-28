/**
 * End-to-End-Workflow-Tests: simuliert komplette Cross-Source-Mention-Flows
 * gegen mock-Deps und mock-Publish. Prüft, dass die einzelnen Komponenten
 * korrekt zusammen arbeiten — pending-Late-Binding, Idempotenz beim Replay,
 * URL-Patterns ohne DB-Lookup.
 *
 * Echter NATS/Postgres-Smoke-Test ist optional ein manueller Lauf gegen
 * die laufende Pipeline (`pnpm backend --workers connectors,materializer,
 * mention-extractor`) und liegt außerhalb der Unit-Tests.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MessageContext, RecordPayload } from '@repo/messaging';
import { PendingMentions } from './pending';
import { processNewJiraIssue, processRecord } from './processor';
import type { ResolverDeps } from './resolver';

function emptyDeps(): ResolverDeps {
  return {
    queryJiraIssueByKey: vi.fn().mockResolvedValue(null),
    queryChannelById: vi.fn().mockResolvedValue(null),
  };
}

function slackMessage(body: string, ts = '123.456'): RecordPayload {
  return {
    id: `slack:msg:hackathon/C1/${ts}`,
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
    title: 'Bug',
    body: 'Description',
    payload: { key },
    created_at: '2026-04-15T10:00:00.000Z',
    updated_at: '2026-04-15T10:00:00.000Z',
  };
}

function ctx(eventId: string): MessageContext {
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
      subject_id: '',
      payload: {},
      evidence: null,
      causation_id: null,
      correlation_id: null,
    },
    seq: 1,
  } as MessageContext;
}

const ackOk = { event_id: 'evt_edge', seq: 1, stream: 'EVENTS', duplicate: false };

describe('mention-extractor workflow', () => {
  it('Late-Binding: Slack-Mention vor Jira-Issue → Edge wird beim Issue-Ankommen emittiert', async () => {
    const deps = emptyDeps();
    const pending = new PendingMentions();
    const publish = vi.fn().mockResolvedValue(ackOk);

    // 1. Slack-Message erwähnt DEMV-4127, das Issue ist noch nicht ingestiert
    await processRecord(
      slackMessage('Wer fixt DEMV-4127?'),
      ctx('evt_slack'),
      deps,
      pending,
      publish,
    );
    expect(publish).not.toHaveBeenCalled();
    expect(pending.size()).toBe(1);

    // 2. Jira-Issue DEMV-4127 wird ingestiert
    await processNewJiraIssue(jiraIssue('DEMV-4127'), ctx('evt_jira'), pending, publish);

    expect(publish).toHaveBeenCalledTimes(1);
    const edgeCall = publish.mock.calls[0]![1];
    expect(edgeCall.payload.from_id).toBe('slack:msg:hackathon/C1/123.456');
    expect(edgeCall.payload.to_id).toBe('jira:issue:DEMV-4127');
    expect(edgeCall.causation_id).toBe('evt_jira');
    expect(pending.size()).toBe(0);
  });

  it('Direkt-Resolve: Slack-Mention nach Jira-Issue → Edge sofort, kein pending', async () => {
    const deps: ResolverDeps = {
      queryJiraIssueByKey: vi.fn().mockResolvedValue({ id: 'jira:issue:DEMV-4127' }),
      queryChannelById: vi.fn().mockResolvedValue(null),
    };
    const pending = new PendingMentions();
    const publish = vi.fn().mockResolvedValue(ackOk);

    await processRecord(
      slackMessage('Wer fixt DEMV-4127?'),
      ctx('evt_slack'),
      deps,
      pending,
      publish,
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![1].payload.to_id).toBe('jira:issue:DEMV-4127');
    expect(pending.size()).toBe(0);
  });

  it('Replay-Idempotenz: dasselbe Slack-Record zweimal → pending wächst nicht doppelt', async () => {
    const deps = emptyDeps();
    const pending = new PendingMentions();
    const publish = vi.fn();

    const record = slackMessage('Wer fixt DEMV-4127?');
    await processRecord(record, ctx('evt_slack'), deps, pending, publish);
    await processRecord(record, ctx('evt_slack'), deps, pending, publish);

    expect(pending.size()).toBe(1);
  });

  it('Multi-Source-Cross-References in einem Body', async () => {
    const deps: ResolverDeps = {
      queryJiraIssueByKey: vi.fn(async (key) =>
        key === 'DEMV-4127' ? { id: 'jira:issue:DEMV-4127' } : null,
      ),
      queryChannelById: vi.fn().mockResolvedValue(null),
    };
    const pending = new PendingMentions();
    const publish = vi.fn().mockResolvedValue(ackOk);

    await processRecord(
      slackMessage('Issue DEMV-4127 hängt mit https://github.com/foo/bar/pull/12 zusammen.'),
      ctx('evt'),
      deps,
      pending,
      publish,
    );

    expect(publish).toHaveBeenCalledTimes(2);
    const targets = publish.mock.calls.map((c) => c[1].payload.to_id).sort();
    expect(targets).toEqual(['github:pr:foo/bar/12', 'jira:issue:DEMV-4127']);
  });

  it('Mehrere Slack-Messages gleicher Jira-Key → eine Edge pro Slack-Message beim Issue-Ankommen', async () => {
    const deps = emptyDeps();
    const pending = new PendingMentions();
    const publish = vi.fn().mockResolvedValue(ackOk);

    // Drei Slack-Messages, alle mit DEMV-4127
    await processRecord(
      slackMessage('Erste Erwähnung von DEMV-4127', '111.111'),
      ctx('evt1'),
      deps,
      pending,
      publish,
    );
    await processRecord(
      slackMessage('Auch DEMV-4127 betrifft uns', '222.222'),
      ctx('evt2'),
      deps,
      pending,
      publish,
    );
    await processRecord(
      slackMessage('DEMV-4127 ist offen', '333.333'),
      ctx('evt3'),
      deps,
      pending,
      publish,
    );
    expect(pending.size()).toBe(3);
    expect(publish).not.toHaveBeenCalled();

    // Jira-Issue kommt
    await processNewJiraIssue(jiraIssue('DEMV-4127'), ctx('evt_jira'), pending, publish);

    expect(publish).toHaveBeenCalledTimes(3);
    const fromIds = publish.mock.calls.map((c) => c[1].payload.from_id).sort();
    expect(fromIds).toEqual([
      'slack:msg:hackathon/C1/111.111',
      'slack:msg:hackathon/C1/222.222',
      'slack:msg:hackathon/C1/333.333',
    ]);
    expect(pending.size()).toBe(0);
  });
});
