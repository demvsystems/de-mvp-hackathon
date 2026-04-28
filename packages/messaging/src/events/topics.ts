import { z } from 'zod';
import { defineEvent } from '../event';

export const TopicCreatedPayload = z.object({
  id: z.string(),
  status: z.literal('active'),
  discovered_by: z.string(),
  initial_centroid_summary: z.object({
    sample_record_ids: z.array(z.string()),
    cluster_size: z.number().int(),
    intra_cluster_distance_avg: z.number(),
  }),
  centroid_body_only: z.array(z.number()).nullable().default(null),
  member_count_body_only: z.number().int().nullable().default(null),
});
export type TopicCreatedPayload = z.infer<typeof TopicCreatedPayload>;

export const TopicUpdatedPayload = z.object({
  id: z.string(),
  label: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  centroid_body_only: z.array(z.number()).nullable().default(null),
  member_count_body_only: z.number().int().nullable().default(null),
});
export type TopicUpdatedPayload = z.infer<typeof TopicUpdatedPayload>;

export const TopicArchivedPayload = z.object({
  id: z.string(),
  reason: z.string().nullable(),
});
export type TopicArchivedPayload = z.infer<typeof TopicArchivedPayload>;

export const TopicSupersededPayload = z.object({
  id: z.string(),
  superseded_by: z.string(),
});
export type TopicSupersededPayload = z.infer<typeof TopicSupersededPayload>;

export const TopicCreated = defineEvent({
  event_type: 'topic.created',
  subject_template: 'events.topic.created',
  subject_kind: 'topic',
  payload: TopicCreatedPayload,
});

export const TopicUpdated = defineEvent({
  event_type: 'topic.updated',
  subject_template: 'events.topic.updated',
  subject_kind: 'topic',
  payload: TopicUpdatedPayload,
});

export const TopicArchived = defineEvent({
  event_type: 'topic.archived',
  subject_template: 'events.topic.archived',
  subject_kind: 'topic',
  payload: TopicArchivedPayload,
});

export const TopicSuperseded = defineEvent({
  event_type: 'topic.superseded',
  subject_template: 'events.topic.superseded',
  subject_kind: 'topic',
  payload: TopicSupersededPayload,
});
