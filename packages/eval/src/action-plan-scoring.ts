// Standalone scoring for proposed vs. expected ActionPlan. Can be wired into
// the rubric runner as a `code`-kind criterion or invoked directly from
// integration tests against gold-standard fixtures.

import type { Action, ActionPlan, CrossRef } from '@repo/agent/shared';

export interface ActionPlanScore {
  /** 0..1, weighted average of sub-scores. */
  overall: number;
  /** Jaccard over (kind, target-key) tuples. */
  action_set: number;
  /** Match of cross-reference structure (set Jaccard over (from-kind, to-kind, type)). */
  cross_refs: number;
  /** Slack thread-vs-channel placement correctness (1 if all slack actions match, else fraction). */
  placement: number;
  /** Crude body-text overlap (token-level Jaccard) — replace with LLM judge for production. */
  body_overlap: number;
}

function targetKey(action: Action): string {
  switch (action.kind) {
    case 'create_jira_ticket':
      return `jira:${action.project}:${action.issue_type}`;
    case 'post_slack_message':
      return `slack:${action.channel}:${action.placement.mode}`;
    case 'reply_intercom':
      return `intercom:${action.conversation_record_id}`;
    case 'no_action':
      return 'no_action';
  }
}

function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect += 1;
  const union = a.size + b.size - intersect;
  return union === 0 ? 1 : intersect / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function bodyOverlap(proposed: ActionPlan, expected: ActionPlan): number {
  // Pair actions by index where both have a body, take token Jaccard, average.
  const pairs: Array<[Action, Action]> = [];
  const len = Math.min(proposed.actions.length, expected.actions.length);
  for (let i = 0; i < len; i++) {
    pairs.push([proposed.actions[i]!, expected.actions[i]!]);
  }
  if (pairs.length === 0) return 0;
  const scores = pairs.map(([p, e]) => {
    const pBody = 'body' in p ? p.body : '';
    const eBody = 'body' in e ? e.body : '';
    if (pBody === '' && eBody === '') return 1;
    return jaccard(tokenize(pBody), tokenize(eBody));
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function placementScore(proposed: ActionPlan, expected: ActionPlan): number {
  const slackProposed = proposed.actions.filter(
    (a): a is Extract<Action, { kind: 'post_slack_message' }> => a.kind === 'post_slack_message',
  );
  const slackExpected = expected.actions.filter(
    (a): a is Extract<Action, { kind: 'post_slack_message' }> => a.kind === 'post_slack_message',
  );
  if (slackExpected.length === 0) return 1;

  const expectedModes = new Set(slackExpected.map((a) => a.placement.mode));
  const proposedModes = new Set(slackProposed.map((a) => a.placement.mode));
  return jaccard(expectedModes, proposedModes);
}

function crossRefScore(proposed: ActionPlan, expected: ActionPlan): number {
  const toKindKey =
    (plan: ActionPlan) =>
    (cr: CrossRef): string => {
      const from = plan.actions[cr.from_action_idx]?.kind ?? 'unknown';
      const to = plan.actions[cr.to_action_idx]?.kind ?? 'unknown';
      return `${from}->${to}:${cr.type}`;
    };
  const a = new Set(expected.cross_references.map(toKindKey(expected)));
  const b = new Set(proposed.cross_references.map(toKindKey(proposed)));
  return jaccard(a, b);
}

export function scoreActionPlan(
  proposed: ActionPlan | null,
  expected: ActionPlan,
): ActionPlanScore {
  if (proposed === null) {
    return { overall: 0, action_set: 0, cross_refs: 0, placement: 0, body_overlap: 0 };
  }
  const action_set = jaccard(
    new Set(proposed.actions.map(targetKey)),
    new Set(expected.actions.map(targetKey)),
  );
  const cross_refs = crossRefScore(proposed, expected);
  const placement = placementScore(proposed, expected);
  const body_overlap = bodyOverlap(proposed, expected);
  // Weights: action set is most important, cross-refs next, placement and body
  // tertiary. Body overlap is a crude proxy until the LLM judge is wired in.
  const overall = 0.45 * action_set + 0.25 * cross_refs + 0.15 * placement + 0.15 * body_overlap;
  return { overall, action_set, cross_refs, placement, body_overlap };
}
