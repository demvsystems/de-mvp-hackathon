import { z } from 'zod';

const Meta = z.object({ emit_at_offset_seconds: z.number() });

export const SlackWorkspaceRow = z.object({
  _meta: Meta,
  team_id: z.string(),
  name: z.string(),
  domain: z.string().nullable().optional(),
  occurred_at: z.string().datetime(),
});
export type SlackWorkspaceRow = z.infer<typeof SlackWorkspaceRow>;

export const SlackChannelRow = z.object({
  _meta: Meta,
  team_id: z.string(),
  channel_id: z.string(),
  name: z.string(),
  is_private: z.boolean().default(false),
  occurred_at: z.string().datetime(),
});
export type SlackChannelRow = z.infer<typeof SlackChannelRow>;

export const SlackUserRow = z.object({
  _meta: Meta,
  team_id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  real_name: z.string().nullable(),
  is_bot: z.boolean().default(false),
  is_external: z.boolean().default(false),
  occurred_at: z.string().datetime(),
});
export type SlackUserRow = z.infer<typeof SlackUserRow>;

export const SlackMessageRow = z.object({
  _meta: Meta,
  team_id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  ts: z.string(),
  thread_ts: z.string().nullable().optional(),
  text: z.string(),
  occurred_at: z.string().datetime(),
});
export type SlackMessageRow = z.infer<typeof SlackMessageRow>;

export type SlackRow =
  | ({ kind: 'workspace' } & SlackWorkspaceRow)
  | ({ kind: 'channel' } & SlackChannelRow)
  | ({ kind: 'user' } & SlackUserRow)
  | ({ kind: 'message' } & SlackMessageRow);
