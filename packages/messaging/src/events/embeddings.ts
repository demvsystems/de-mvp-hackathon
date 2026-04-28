import { z } from 'zod';
import { defineEvent } from '../event';

export const EmbeddingCreatedPayload = z.object({
  record_id: z.string(),
  chunk_idx: z.number().int().min(0).default(0),
  chunk_text: z.string(),
  model_version: z.string(),
  vector: z.array(z.number()),
  generated_at: z.iso.datetime(),
});
export type EmbeddingCreatedPayload = z.infer<typeof EmbeddingCreatedPayload>;

export const EmbeddingCreated = defineEvent({
  event_type: 'embedding.created',
  subject_template: 'events.embedding.created',
  subject_kind: 'embedding',
  payload: EmbeddingCreatedPayload,
});
