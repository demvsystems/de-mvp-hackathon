import { z } from 'zod';

/**
 * Upvoty-Schema (Feature-Voting / Customer-Feedback). An die echte Upvoty-API
 * angelehnt — Doku ist nicht öffentlich, Felder sind aus Help-Center und
 * vergleichbaren Tools (Canny, FeatureBase) abgeleitet. Alle Pilot-fremden
 * Felder bleiben optional, damit minimale Mocks weiter durchgehen.
 *
 * Posts sind das primäre Artefakt, Boards die Container, Comments und Votes
 * die Diskussion drumrum.
 */

/**
 * Rolle eines Upvoty-Users. `admin`/`team` sind interne Mitarbeiter,
 * `customer` ist ein externer Voter/Reporter. Anonyme Voter haben in der
 * echten API einen Cookie-Token statt einer User-ID — der Mapper sieht sie
 * nur, wenn sie in `users[]` aufgelöst wurden.
 */
export const UpvotyUserRole = z.enum(['admin', 'team', 'customer']);
export type UpvotyUserRole = z.infer<typeof UpvotyUserRole>;

export const UpvotyUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  avatar_url: z.string().optional(),
  /** Default-Annahme: ohne explizites Signal ist der User extern. */
  role: UpvotyUserRole.optional(),
  verified: z.boolean().optional(),
  sso_provider: z.string().optional(),
  sso_user_id: z.string().optional(),
  segments: z.array(z.string()).optional(),
  /** Beliebige tenant-spezifische Custom-Fields aus dem Upvoty-Dashboard. */
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  created_at: z.iso.datetime().optional(),
});
export type UpvotyUser = z.infer<typeof UpvotyUser>;

/**
 * Privacy eines Boards: `public` ist auf upvoty.com sichtbar, `private`
 * nur eingeloggten Customers, `password_protected` mit Shared-Password.
 */
export const UpvotyBoardPrivacy = z.enum(['public', 'private', 'password_protected']);
export type UpvotyBoardPrivacy = z.infer<typeof UpvotyBoardPrivacy>;

export const UpvotyBoard = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  privacy: UpvotyBoardPrivacy.optional(),
});
export type UpvotyBoard = z.infer<typeof UpvotyBoard>;

export const UpvotyComment = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  author_id: z.string(),
  /** Comment-Reply: zeigt auf den `id` eines anderen Comments im selben Post. */
  parent_id: z.string().optional(),
  /** Team-only Note (in der Upvoty-UI als „internal note" markiert). */
  is_internal: z.boolean().optional(),
});
export type UpvotyComment = z.infer<typeof UpvotyComment>;

/**
 * Lifecycle-Update auf einem Post. `previous` hält die Felder, die VOR
 * diesem Update auf dem Post standen — analog zu Jira/Intercom. Das
 * Workflow-typische Update ist `status` (Roadmap-Bewegung), die anderen
 * Felder spiegeln Title-/Body-Edits durch Admins.
 */
export const UpvotyPostUpdate = z.object({
  at: z.iso.datetime(),
  previous: z
    .object({
      status: z.string().optional(),
      title: z.string().optional(),
      body: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
      merged_into_id: z.string().nullable().optional(),
    })
    .strict(),
});
export type UpvotyPostUpdate = z.infer<typeof UpvotyPostUpdate>;

export const UpvotyPost = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /**
   * Status-Wert. Kanonische Upvoty-2.0-Werte sind `under_review`, `planned`,
   * `in_progress`, `live`, `closed`; Custom-Statuses sind pro Board möglich,
   * deshalb belassen wir das als String statt Enum.
   */
  status: z.string(),
  board_id: z.string(),
  author_id: z.string(),
  created_at: z.string(),
  slug: z.string().optional(),
  /** „Public Tag", in der Upvoty-UI als Category sichtbar (genau eine pro Post). */
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().optional(),
  /** Bei AI-/Admin-Merge zeigt das auf den Ziel-Post. */
  merged_into_id: z.string().optional(),
  estimated_launch_date: z.string().optional(),
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
