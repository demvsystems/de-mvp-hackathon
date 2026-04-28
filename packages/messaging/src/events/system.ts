import { z } from 'zod';
import { defineEvent } from '../event';

export const ReplayStartedPayload = z.object({
  consumer: z.string(),
  filter_subject: z.string().nullable(),
  started_at: z.iso.datetime(),
});
export type ReplayStartedPayload = z.infer<typeof ReplayStartedPayload>;

export const ReplayCompletedPayload = z.object({
  consumer: z.string(),
  filter_subject: z.string().nullable(),
  started_at: z.iso.datetime(),
  completed_at: z.iso.datetime(),
  processed: z.number().int().min(0),
});
export type ReplayCompletedPayload = z.infer<typeof ReplayCompletedPayload>;

export const SystemReplayStarted = defineEvent({
  event_type: 'system.replay.started',
  subject_template: 'events.system.replay.started',
  subject_kind: 'system',
  payload: ReplayStartedPayload,
});

export const SystemReplayCompleted = defineEvent({
  event_type: 'system.replay.completed',
  subject_template: 'events.system.replay.completed',
  subject_kind: 'system',
  payload: ReplayCompletedPayload,
});
