'use server';

import { revalidatePath } from 'next/cache';
import { db, eq, schema } from '@repo/db';
import {
  publish,
  TopicActionPlanApproved,
  TopicActionPlanModificationRequested,
  TopicActionPlanRejected,
} from '@repo/messaging';
import { z } from 'zod';

const PlanIdInput = z.object({
  plan_id: z.string().uuid(),
});

const ModifyInput = PlanIdInput.extend({
  feedback: z.string().min(1).max(2000),
});

const SOURCE = 'web:human';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function loadPlan(planId: string) {
  const rows = await db
    .select({
      id: schema.topicActionPlans.id,
      topicId: schema.topicActionPlans.topicId,
      status: schema.topicActionPlans.status,
    })
    .from(schema.topicActionPlans)
    .where(eq(schema.topicActionPlans.id, planId))
    .limit(1);
  return rows[0] ?? null;
}

export async function approveActionPlan(raw: z.infer<typeof PlanIdInput>): Promise<ActionResult> {
  const parsed = PlanIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid input' };

  const plan = await loadPlan(parsed.data.plan_id);
  if (!plan) return { ok: false, error: 'plan not found' };
  if (plan.status !== 'proposed') return { ok: false, error: `plan is ${plan.status}` };

  const now = new Date();
  await db
    .update(schema.topicActionPlans)
    .set({
      status: 'approved',
      decisionKind: 'approve',
      decisionAt: now,
      decisionBy: SOURCE,
    })
    .where(eq(schema.topicActionPlans.id, plan.id));

  await publish(TopicActionPlanApproved, {
    source: SOURCE,
    occurred_at: now.toISOString(),
    subject_id: `action_plan:${plan.id}`,
    correlation_id: plan.topicId,
    payload: {
      topic_id: plan.topicId,
      action_plan_id: plan.id,
      approved_at: now.toISOString(),
      approved_by: SOURCE,
    },
  });

  revalidatePath(`/topics/${plan.topicId}`);
  return { ok: true };
}

export async function rejectActionPlan(raw: z.infer<typeof PlanIdInput>): Promise<ActionResult> {
  const parsed = PlanIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid input' };

  const plan = await loadPlan(parsed.data.plan_id);
  if (!plan) return { ok: false, error: 'plan not found' };
  if (plan.status !== 'proposed') return { ok: false, error: `plan is ${plan.status}` };

  const now = new Date();
  await db
    .update(schema.topicActionPlans)
    .set({
      status: 'rejected',
      decisionKind: 'reject',
      decisionAt: now,
      decisionBy: SOURCE,
    })
    .where(eq(schema.topicActionPlans.id, plan.id));

  await publish(TopicActionPlanRejected, {
    source: SOURCE,
    occurred_at: now.toISOString(),
    subject_id: `action_plan:${plan.id}`,
    correlation_id: plan.topicId,
    payload: {
      topic_id: plan.topicId,
      action_plan_id: plan.id,
      rejected_at: now.toISOString(),
      rejected_by: SOURCE,
    },
  });

  revalidatePath(`/topics/${plan.topicId}`);
  return { ok: true };
}

export async function modifyActionPlan(raw: z.infer<typeof ModifyInput>): Promise<ActionResult> {
  const parsed = ModifyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid input' };

  const plan = await loadPlan(parsed.data.plan_id);
  if (!plan) return { ok: false, error: 'plan not found' };
  if (plan.status !== 'proposed') return { ok: false, error: `plan is ${plan.status}` };

  // The reviewer module subscribes to this event; it owns the supersede
  // transition (marks old plan superseded, writes new revised plan).
  const now = new Date();
  await publish(TopicActionPlanModificationRequested, {
    source: SOURCE,
    occurred_at: now.toISOString(),
    subject_id: `action_plan:${plan.id}`,
    correlation_id: plan.topicId,
    payload: {
      topic_id: plan.topicId,
      action_plan_id: plan.id,
      requested_at: now.toISOString(),
      requested_by: SOURCE,
      feedback: parsed.data.feedback,
    },
  });

  revalidatePath(`/topics/${plan.topicId}`);
  return { ok: true };
}
