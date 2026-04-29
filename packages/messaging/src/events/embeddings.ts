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

export const EmbeddingCreatedBodyOnly = defineEvent({
  event_type: 'embedding.created',
  subject_template: 'events.embedding.created.body-only',
  subject_kind: 'embedding',
  payload: EmbeddingCreatedPayload,
});

export const EmbeddingCreatedWithNeighbors = defineEvent({
  event_type: 'embedding.created',
  subject_template: 'events.embedding.created.with-neighbors',
  subject_kind: 'embedding',
  payload: EmbeddingCreatedPayload,
});

// Subscribers route on event_type ('embedding.created'), which both definitions
// share — so existing `.on(EmbeddingCreated, ...)` handlers in materializer and
// topic-discovery keep matching both strategies without code changes.
export const EmbeddingCreated = EmbeddingCreatedBodyOnly;
