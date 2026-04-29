import { z } from 'zod';

export const ActionPlanKind = z.enum([
  'create_jira_ticket',
  'post_slack_message',
  'reply_intercom',
  'no_action',
]);
export type ActionPlanKind = z.infer<typeof ActionPlanKind>;

const CreateJiraTicket = z.object({
  kind: z.literal('create_jira_ticket'),
  project: z.string().min(1),
  issue_type: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  labels: z.array(z.string()).optional(),
  parent_key: z.string().optional(),
});

const SlackPlacement = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('thread'), thread_root_record_id: z.string().min(1) }),
  z.object({ mode: z.literal('channel') }),
]);

const PostSlackMessage = z.object({
  kind: z.literal('post_slack_message'),
  channel: z.string().min(1),
  body: z.string().min(1).max(4000),
  placement: SlackPlacement,
});

const ReplyIntercom = z.object({
  kind: z.literal('reply_intercom'),
  conversation_record_id: z.string().min(1),
  body: z.string().min(1).max(4000),
  internal_note: z.boolean().optional(),
});

const NoAction = z.object({
  kind: z.literal('no_action'),
  reason: z.string().min(1).max(500),
});

export const Action = z.discriminatedUnion('kind', [
  CreateJiraTicket,
  PostSlackMessage,
  ReplyIntercom,
  NoAction,
]);
export type Action = z.infer<typeof Action>;

export const CrossRef = z.object({
  from_action_idx: z.number().int().nonnegative(),
  to_action_idx: z.number().int().nonnegative(),
  type: z.enum(['mentions', 'replies_to']),
});
export type CrossRef = z.infer<typeof CrossRef>;

export const ActionPlan = z.object({
  rationale: z.string().min(1).max(1000),
  actions: z.array(Action).max(6),
  cross_references: z.array(CrossRef).max(12),
});
export type ActionPlan = z.infer<typeof ActionPlan>;
