import { z } from 'zod';

export const SubjectKind = z.enum(['record', 'edge', 'topic', 'embedding', 'assessment', 'system']);
export type SubjectKind = z.infer<typeof SubjectKind>;

export const EventEnvelope = z.object({
  event_id: z.string(),
  event_type: z.string(),
  schema_version: z.number().int().min(1),
  occurred_at: z.iso.datetime(),
  observed_at: z.iso.datetime(),
  source: z.string(),
  source_event_id: z.string().nullable(),
  subject_kind: SubjectKind,
  subject_id: z.string(),
  payload: z.unknown(),
  evidence: z.unknown().nullable(),
  causation_id: z.string().nullable(),
  correlation_id: z.string().nullable(),
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;
