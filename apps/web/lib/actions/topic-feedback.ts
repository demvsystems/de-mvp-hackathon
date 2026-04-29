'use server';

import { revalidatePath } from 'next/cache';
import { sql } from '@repo/db';
import { getDefaultLangfuseClient } from '@repo/agent';
import { TopicFeedbackInputSchema, type TopicFeedbackInput } from '@/lib/topic-feedback';

export interface TopicFeedbackResult {
  ok: boolean;
  error?: string;
}

export async function submitTopicFeedback(raw: TopicFeedbackInput): Promise<TopicFeedbackResult> {
  const parsed = TopicFeedbackInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const v = parsed.data;

  await sql`
    INSERT INTO topic_feedback
      (topic_id, assessor, assessed_at, trace_id,
       thumb, rating, corrected_character, corrected_escalation_score, note)
    VALUES
      (${v.topic_id}, ${v.assessor}, ${v.assessed_at}, ${v.trace_id},
       ${v.thumb}, ${v.rating}, ${v.corrected_character},
       ${v.corrected_escalation_score}, ${v.note?.trim() || null})
  `;

  if (v.trace_id) {
    const lf = getDefaultLangfuseClient();
    if (lf) {
      try {
        if (v.thumb !== null) {
          lf.score.create({
            traceId: v.trace_id,
            name: 'user.thumb',
            value: v.thumb === 'up' ? 1 : 0,
            dataType: 'NUMERIC',
            ...(v.note ? { comment: v.note } : {}),
          });
        }
        if (v.rating !== null) {
          lf.score.create({
            traceId: v.trace_id,
            name: 'user.rating',
            value: v.rating,
            dataType: 'NUMERIC',
          });
        }
        if (v.corrected_character !== null) {
          lf.score.create({
            traceId: v.trace_id,
            name: 'user.corrected_character',
            value: v.corrected_character,
            dataType: 'CATEGORICAL',
          });
        }
        if (v.corrected_escalation_score !== null) {
          lf.score.create({
            traceId: v.trace_id,
            name: 'user.corrected_escalation_score',
            value: v.corrected_escalation_score,
            dataType: 'NUMERIC',
          });
        }
        await lf.flush();
      } catch (err) {
        console.warn('[topic-feedback] langfuse mirror failed', err);
      }
    }
  }

  revalidatePath(`/topics/${v.topic_id}`);
  revalidatePath('/admin/reviews');
  return { ok: true };
}
