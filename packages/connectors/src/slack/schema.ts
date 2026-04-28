import { z } from 'zod';

export const SlackParticipant = z.object({
  id: z.string(),
  display_name: z.string(),
  real_name: z.string(),
  role_hint: z.string().optional(),
});
export type SlackParticipant = z.infer<typeof SlackParticipant>;

const SlackAuthorRef = z.object({
  id: z.string(),
  display_name: z.string(),
});

const SlackReaction = z.object({
  name: z.string(),
  count: z.number(),
  users: z.array(z.string()),
});

/**
 * Eine Slack-Chat-Nachricht oder Thread-Reply. Threads sind genested:
 * `thread.messages[]` enthält die Replies. Beim Top-Level-Message zeigt
 * `thread.root_message_id` auf die eigene `id` — Replies haben dort die
 * Top-Level-`id` des Threads.
 */
export interface SlackChatMessage {
  type: 'chat_message' | 'thread_reply';
  id: string;
  slack_ts: string;
  datetime: string;
  author: { id: string; display_name: string };
  text: string;
  mentions: string[];
  reactions: Array<{ name: string; count: number; users: string[] }>;
  // Top-Level-Messages haben `thread` (mit `null` oder Objekt). Thread-Replies
  // im Mock lassen das Feld weg — daher optional mit explizit `undefined`.
  thread?:
    | {
        id: string;
        root_message_id: string;
        reply_count: number;
        messages: SlackChatMessage[];
      }
    | null
    | undefined;
}

export const SlackChatMessage: z.ZodType<SlackChatMessage> = z.lazy(() =>
  z.object({
    type: z.enum(['chat_message', 'thread_reply']),
    id: z.string(),
    slack_ts: z.string(),
    datetime: z.iso.datetime(),
    author: SlackAuthorRef,
    text: z.string(),
    mentions: z.array(z.string()),
    reactions: z.array(SlackReaction),
    thread: z
      .object({
        id: z.string(),
        root_message_id: z.string(),
        reply_count: z.number(),
        messages: z.array(SlackChatMessage),
      })
      .nullish(),
  }),
);

export const SlackChannel = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
  type: z.string(),
  topic: z.string().optional(),
  purpose: z.string().optional(),
});
export type SlackChannel = z.infer<typeof SlackChannel>;

/**
 * Top-Level-Snapshot, wie ihn der Daten-Generator liefert: ein Channel mit
 * Teilnehmern und einer Message-Liste. Threads sind in `content[].thread`
 * eingebettet.
 */
export const SlackSnapshot = z.object({
  channel: SlackChannel,
  participants: z.array(SlackParticipant),
  content: z.array(SlackChatMessage),
});
export type SlackSnapshot = z.infer<typeof SlackSnapshot>;
