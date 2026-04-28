import { z } from 'zod';

/**
 * Skelett-Schema gegen die Upvoty-API-Form (Feature-Voting-Tool). Sobald
 * echte Mocks vorliegen, gleichen wir Felder ab. Posts sind das primäre
 * Artefakt, Boards die Container, Comments die Diskussion drumrum.
 */

export const UpvotyUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
});
export type UpvotyUser = z.infer<typeof UpvotyUser>;

export const UpvotyBoard = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
});
export type UpvotyBoard = z.infer<typeof UpvotyBoard>;

export const UpvotyComment = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  author_id: z.string(),
});
export type UpvotyComment = z.infer<typeof UpvotyComment>;

/**
 * Lifecycle-Update auf einem Post. `previous` hält die Felder, die VOR
 * diesem Update auf dem Post standen — analog zu Jira/Intercom.
 */
export const UpvotyPostUpdate = z.object({
  at: z.iso.datetime(),
  previous: z
    .object({
      status: z.string().optional(),
      title: z.string().optional(),
      body: z.string().nullable().optional(),
    })
    .strict(),
});
export type UpvotyPostUpdate = z.infer<typeof UpvotyPostUpdate>;

export const UpvotyPost = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  status: z.string(),
  board_id: z.string(),
  author_id: z.string(),
  created_at: z.string(),
  vote_count: z.number().default(0),
  voter_ids: z.array(z.string()).default([]),
  comments: z.array(UpvotyComment).default([]),
  updates: z.array(UpvotyPostUpdate).optional(),
  deleted_at: z.iso.datetime().optional(),
});
export type UpvotyPost = z.infer<typeof UpvotyPost>;

export const UpvotySnapshot = z.object({
  boards: z.array(UpvotyBoard).default([]),
  users: z.array(UpvotyUser).default([]),
  posts: z.array(UpvotyPost).default([]),
});
export type UpvotySnapshot = z.infer<typeof UpvotySnapshot>;
