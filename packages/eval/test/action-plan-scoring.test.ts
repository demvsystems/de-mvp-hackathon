import { describe, expect, it } from 'vitest';
import type { ActionPlan } from '@repo/agent/shared';
import { scoreActionPlan } from '../src/action-plan-scoring';

const goldCheckout: ActionPlan = {
  rationale: 'Bug confirmed in multiple sources.',
  actions: [
    {
      kind: 'create_jira_ticket',
      project: 'SHOP',
      issue_type: 'Bug',
      title: 'Checkout 502',
      body: 'Reproduziert in Slack-Thread; Kunden betroffen.',
    },
    {
      kind: 'reply_intercom',
      conversation_record_id: 'intercom:conv_9001',
      body: 'Wir haben den Fehler reproduziert und ein Bug-Ticket angelegt.',
    },
    {
      kind: 'post_slack_message',
      channel: '#bugs',
      body: 'Bug-Ticket angelegt. Kunde via Intercom benachrichtigt.',
      placement: { mode: 'thread', thread_root_record_id: 'slack:msg_004' },
    },
  ],
  cross_references: [
    { from_action_idx: 1, to_action_idx: 0, type: 'mentions' },
    { from_action_idx: 2, to_action_idx: 0, type: 'mentions' },
  ],
};

describe('scoreActionPlan', () => {
  it('returns 1.0 across the board for an identical plan', () => {
    const score = scoreActionPlan(goldCheckout, goldCheckout);
    expect(score.action_set).toBe(1);
    expect(score.cross_refs).toBe(1);
    expect(score.placement).toBe(1);
    expect(score.body_overlap).toBeGreaterThan(0.99);
    expect(score.overall).toBeGreaterThan(0.99);
  });

  it('penalizes a plan that drops the slack action', () => {
    const proposed: ActionPlan = {
      ...goldCheckout,
      actions: goldCheckout.actions.slice(0, 2),
      cross_references: [{ from_action_idx: 1, to_action_idx: 0, type: 'mentions' }],
    };
    const score = scoreActionPlan(proposed, goldCheckout);
    expect(score.action_set).toBeLessThan(1);
    expect(score.overall).toBeLessThan(0.9);
  });

  it('penalizes wrong slack channel placement (thread vs channel)', () => {
    const proposed: ActionPlan = {
      ...goldCheckout,
      actions: goldCheckout.actions.map((a) =>
        a.kind === 'post_slack_message' ? { ...a, placement: { mode: 'channel' as const } } : a,
      ),
    };
    const score = scoreActionPlan(proposed, goldCheckout);
    expect(score.placement).toBeLessThan(1);
  });

  it('returns zeros when proposed is null', () => {
    const score = scoreActionPlan(null, goldCheckout);
    expect(score.overall).toBe(0);
    expect(score.action_set).toBe(0);
  });
});
