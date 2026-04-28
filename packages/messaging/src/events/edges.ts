import { z } from 'zod';
import { defineEvent } from '../event';

export const EdgeType = z.enum([
  'authored_by',
  'replies_to',
  'commented_on',
  'posted_in',
  'child_of',
  'references',
  'assigned_to',
  'belongs_to_sprint',
  'mentions',
  'discusses',
  'supersedes',
]);
export type EdgeType = z.infer<typeof EdgeType>;

export const EdgeObservedPayload = z.object({
  from_id: z.string(),
  to_id: z.string(),
  type: EdgeType,
  source: z.string(),
  confidence: z.number().min(0).max(1),
  weight: z.number().min(0).default(1.0),
  valid_from: z.iso.datetime(),
  valid_to: z.iso.datetime().nullable(),
});
export type EdgeObservedPayload = z.infer<typeof EdgeObservedPayload>;

export const EdgeObserved = defineEvent({
  event_type: 'edge.observed',
  subject_template: 'events.edge.observed.{source}',
  subject_kind: 'edge',
  payload: EdgeObservedPayload,
});
