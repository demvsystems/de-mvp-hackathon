import { z } from 'zod';

const Character = z.enum(['attention', 'opportunity', 'noteworthy', 'calm']);
const Thumb = z.enum(['up', 'down']);

export const TopicFeedbackInputSchema = z
  .object({
    topic_id: z.string().min(1),
    assessor: z.string().min(1),
    assessed_at: z.iso.datetime(),
    trace_id: z.string().nullable(),
    thumb: Thumb.nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    corrected_character: Character.nullable(),
    corrected_escalation_score: z.number().min(0).max(1).nullable(),
    note: z.string().max(2000).nullable(),
  })
  .refine(
    (v) =>
      v.thumb !== null ||
      v.rating !== null ||
      v.corrected_character !== null ||
      v.corrected_escalation_score !== null ||
      (v.note !== null && v.note.trim().length > 0),
    { message: 'feedback must include at least one signal' },
  );

export type TopicFeedbackInput = z.infer<typeof TopicFeedbackInputSchema>;
