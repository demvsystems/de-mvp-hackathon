import { z } from 'zod';

/**
 * Skelett-Schema gegen die Intercom-API-Form. Sobald echte Mocks vorliegen,
 * gleichen wir Felder ab — die Struktur (Conversations mit Parts, Contacts,
 * Agents) sollte stabil sein.
 */

export const IntercomActor = z.object({
  type: z.enum(['user', 'admin', 'bot']),
  id: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
});
export type IntercomActor = z.infer<typeof IntercomActor>;

export const IntercomConversationPart = z.object({
  id: z.string(),
  part_type: z.string(),
  body: z.string().nullable(),
  created_at: z.string(),
  author: IntercomActor,
});
export type IntercomConversationPart = z.infer<typeof IntercomConversationPart>;

/**
 * Lifecycle-Update auf einer Conversation. `previous` hält die Felder, die VOR
 * diesem Update auf der Conversation standen — der Mapper rekonstruiert daraus
 * den Stand vor jedem Update. Updates sind chronologisch aufsteigend.
 */
export const IntercomConversationUpdate = z.object({
  at: z.iso.datetime(),
  previous: z
    .object({
      state: z.string().optional(),
      assignee_id: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      subject: z.string().nullable().optional(),
    })
    .strict(),
});
export type IntercomConversationUpdate = z.infer<typeof IntercomConversationUpdate>;

export const IntercomConversation = z.object({
  id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  state: z.string(),
  subject: z.string().nullable().optional(),
  contact: IntercomActor,
  assignee_id: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  parts: z.array(IntercomConversationPart).default([]),
  updates: z.array(IntercomConversationUpdate).optional(),
  deleted_at: z.iso.datetime().optional(),
});
export type IntercomConversation = z.infer<typeof IntercomConversation>;

export const IntercomContact = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  external_id: z.string().optional(),
});
export type IntercomContact = z.infer<typeof IntercomContact>;

export const IntercomAgent = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
});
export type IntercomAgent = z.infer<typeof IntercomAgent>;

export const IntercomSnapshot = z.object({
  conversations: z.array(IntercomConversation).default([]),
  contacts: z.array(IntercomContact).default([]),
  agents: z.array(IntercomAgent).default([]),
});
export type IntercomSnapshot = z.infer<typeof IntercomSnapshot>;
