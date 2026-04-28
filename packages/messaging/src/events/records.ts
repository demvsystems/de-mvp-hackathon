import { z } from 'zod';
import { defineEvent } from '../event';

export const RecordPayload = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type RecordPayload = z.infer<typeof RecordPayload>;

export const RecordIdPayload = z.object({
  id: z.string(),
});
export type RecordIdPayload = z.infer<typeof RecordIdPayload>;

export const RecordObserved = defineEvent({
  event_type: 'record.observed',
  subject_template: 'events.record.observed.{source}',
  subject_kind: 'record',
  payload: RecordPayload,
});

export const RecordUpdated = defineEvent({
  event_type: 'record.updated',
  subject_template: 'events.record.updated.{source}',
  subject_kind: 'record',
  payload: RecordPayload,
});

export const RecordDeleted = defineEvent({
  event_type: 'record.deleted',
  subject_template: 'events.record.deleted.{source}',
  subject_kind: 'record',
  payload: RecordIdPayload,
});

export const RecordTombstoned = defineEvent({
  event_type: 'record.tombstoned',
  subject_template: 'events.record.tombstoned.{source}',
  subject_kind: 'record',
  payload: RecordIdPayload,
});
