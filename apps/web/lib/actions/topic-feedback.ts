'use server';

import { revalidatePath } from 'next/cache';
import { sql } from '@repo/db';
import { getDefaultLangfuseClient } from '@repo/agent';
import { TopicFeedbackInputSchema, type TopicFeedbackInput } from '@/lib/topic-feedback';

export interface TopicFeedbackResult {
  ok: boolean;
  error?: string;
}

function candidateReason(v: TopicFeedbackInput): string | null {
  const reasons: string[] = [];
  if (v.thumb === 'down') reasons.push('thumbs_down');
  if (v.rating !== null && v.rating <= 2) reasons.push(`rating_${v.rating}`);
  if (v.corrected_character !== null) reasons.push('corrected_character');
  if (v.corrected_escalation_score !== null) reasons.push('corrected_escalation_score');
  return reasons.length > 0 ? reasons.join(',') : null;
}

export async function submitTopicFeedback(raw: TopicFeedbackInput): Promise<TopicFeedbackResult> {
  const parsed = TopicFeedbackInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const v = parsed.data;
  const reason = candidateReason(v);

  const inserted = await sql<{ id: string }[]>`
    INSERT INTO topic_feedback
      (topic_id, assessor, assessed_at, trace_id,
       thumb, rating, corrected_character, corrected_escalation_score, note)
    VALUES
      (${v.topic_id}, ${v.assessor}, ${v.assessed_at}, ${v.trace_id},
       ${v.thumb}, ${v.rating}, ${v.corrected_character},
       ${v.corrected_escalation_score}, ${v.note?.trim() || null})
    RETURNING id::text AS id
  `;
  const feedbackId = inserted[0]?.id ?? null;

  if (reason !== null && feedbackId !== null) {
    await sql`
      INSERT INTO golden_example_candidates
        (feedback_id, topic_id, assessor, assessed_at, trace_id,
         category, reason, note, payload)
      VALUES
        (${feedbackId}, ${v.topic_id}, ${v.assessor}, ${v.assessed_at}, ${v.trace_id},
         ${'edge'}, ${reason}, ${v.note?.trim() || null},
         ${JSON.stringify({
           thumb: v.thumb,
           rating: v.rating,
           corrected_character: v.corrected_character,
           corrected_escalation_score: v.corrected_escalation_score,
         })}::jsonb)
      ON CONFLICT (feedback_id) DO NOTHING
    `;
  }

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
