import 'server-only';

import { db, desc, eq, schema } from '@repo/db';
import type { ActionPlan } from '@repo/agent/shared';

export type ActionPlanStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'executing'
  | 'executed'
  | 'failed';

export interface ActionPlanRow {
  id: string;
  topic_id: string;
  session_id: string;
  supersedes_id: string | null;
  status: ActionPlanStatus;
  plan: ActionPlan;
  rationale: string | null;
  proposed_at: string;
  decision_kind: string | null;
  decision_at: string | null;
  decision_by: string | null;
  modification_feedback: string | null;
  executed_at: string | null;
  created_records: string[] | null;
  error: string | null;
}

const KNOWN_STATUSES: ActionPlanStatus[] = [
  'proposed',
  'approved',
  'rejected',
  'superseded',
  'executing',
  'executed',
  'failed',
];

function asStatus(value: string | null | undefined): ActionPlanStatus {
  return KNOWN_STATUSES.includes(value as ActionPlanStatus)
    ? (value as ActionPlanStatus)
    : 'proposed';
}

export async function listActionPlansForTopic(topicId: string): Promise<ActionPlanRow[]> {
  const rows = await db
    .select()
    .from(schema.topicActionPlans)
    .where(eq(schema.topicActionPlans.topicId, topicId))
    .orderBy(desc(schema.topicActionPlans.proposedAt));
  return rows.map((r) => ({
    id: r.id,
    topic_id: r.topicId,
    session_id: r.sessionId,
    supersedes_id: r.supersedesId,
    status: asStatus(r.status),
    plan: r.plan as ActionPlan,
    rationale: r.rationale,
    proposed_at: r.proposedAt.toISOString(),
    decision_kind: r.decisionKind,
    decision_at: r.decisionAt?.toISOString() ?? null,
    decision_by: r.decisionBy,
    modification_feedback: r.modificationFeedback,
    executed_at: r.executedAt?.toISOString() ?? null,
    created_records: (r.createdRecords as string[] | null) ?? null,
    error: r.error,
  }));
}
