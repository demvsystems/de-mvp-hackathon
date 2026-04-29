'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sql } from '@repo/db';

const ReviewInput = z.object({
  id: z.string().min(1),
  status: z.enum(['reviewed', 'dismissed']),
});

export interface ReviewFeedbackResult {
  ok: boolean;
  error?: string;
}

export async function setFeedbackStatus(
  raw: z.input<typeof ReviewInput>,
): Promise<ReviewFeedbackResult> {
  const parsed = ReviewInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  await sql`
    UPDATE topic_feedback
       SET status = ${parsed.data.status}, reviewed_at = NOW()
     WHERE id = ${parsed.data.id}::bigint
  `;
  revalidatePath('/admin/reviews');
  return { ok: true };
}

export async function setGuardrailEventStatus(
  raw: z.input<typeof ReviewInput>,
): Promise<ReviewFeedbackResult> {
  const parsed = ReviewInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  await sql`
    UPDATE guardrail_events
       SET status = ${parsed.data.status}, reviewed_at = NOW()
     WHERE id = ${parsed.data.id}::bigint
  `;
  revalidatePath('/admin/reviews');
  return { ok: true };
}

export async function setGoldenCandidateStatus(
  raw: z.input<typeof ReviewInput>,
): Promise<ReviewFeedbackResult> {
  const parsed = ReviewInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  await sql`
    UPDATE golden_example_candidates
       SET status = ${parsed.data.status}, reviewed_at = NOW()
     WHERE id = ${parsed.data.id}::bigint
  `;
  revalidatePath('/admin/reviews');
  return { ok: true };
}
