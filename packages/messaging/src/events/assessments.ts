import { z } from 'zod';
import { defineEvent } from '../event';

export const AssessmentCharacter = z.enum(['attention', 'opportunity', 'noteworthy', 'calm']);
export type AssessmentCharacter = z.infer<typeof AssessmentCharacter>;

export const AssessmentCreatedPayload = z.object({
  topic_id: z.string(),
  assessor: z.string(),
  assessed_at: z.iso.datetime(),
  character: AssessmentCharacter,
  escalation_score: z.number(),
  reasoning: z.record(z.string(), z.unknown()),
  triggered_by: z.string().nullable(),
});
export type AssessmentCreatedPayload = z.infer<typeof AssessmentCreatedPayload>;

export const TopicAssessmentCreated = defineEvent({
  event_type: 'topic.assessment.created',
  subject_template: 'events.topic.assessment.created',
  subject_kind: 'assessment',
  payload: AssessmentCreatedPayload,
});
