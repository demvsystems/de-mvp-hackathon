import { z } from 'zod';
import { defineEvent } from '../event';

const PlanRef = z.object({
  topic_id: z.string(),
  action_plan_id: z.string().uuid(),
});

export const ActionPlanProposedPayload = PlanRef.extend({
  session_id: z.string().uuid(),
  supersedes_id: z.string().uuid().nullable(),
  proposed_at: z.iso.datetime(),
  rationale: z.string(),
  action_count: z.number().int().nonnegative(),
});
export type ActionPlanProposedPayload = z.infer<typeof ActionPlanProposedPayload>;

export const ActionPlanApprovedPayload = PlanRef.extend({
  approved_at: z.iso.datetime(),
  approved_by: z.string().nullable(),
});
export type ActionPlanApprovedPayload = z.infer<typeof ActionPlanApprovedPayload>;

export const ActionPlanRejectedPayload = PlanRef.extend({
  rejected_at: z.iso.datetime(),
  rejected_by: z.string().nullable(),
});
export type ActionPlanRejectedPayload = z.infer<typeof ActionPlanRejectedPayload>;

export const ActionPlanModificationRequestedPayload = PlanRef.extend({
  requested_at: z.iso.datetime(),
  requested_by: z.string().nullable(),
  feedback: z.string().min(1),
});
export type ActionPlanModificationRequestedPayload = z.infer<
  typeof ActionPlanModificationRequestedPayload
>;

export const ActionPlanExecutedPayload = PlanRef.extend({
  executed_at: z.iso.datetime(),
  executor_run_id: z.string(),
  created_record_ids: z.array(z.string()),
});
export type ActionPlanExecutedPayload = z.infer<typeof ActionPlanExecutedPayload>;

export const ActionPlanFailedPayload = PlanRef.extend({
  failed_at: z.iso.datetime(),
  executor_run_id: z.string(),
  error: z.string(),
});
export type ActionPlanFailedPayload = z.infer<typeof ActionPlanFailedPayload>;

export const TopicActionPlanProposed = defineEvent({
  event_type: 'topic.action_plan.proposed',
  subject_template: 'events.topic.action_plan.proposed',
  subject_kind: 'action_plan',
  payload: ActionPlanProposedPayload,
});

export const TopicActionPlanApproved = defineEvent({
  event_type: 'topic.action_plan.approved',
  subject_template: 'events.topic.action_plan.approved',
  subject_kind: 'action_plan',
  payload: ActionPlanApprovedPayload,
});

export const TopicActionPlanRejected = defineEvent({
  event_type: 'topic.action_plan.rejected',
  subject_template: 'events.topic.action_plan.rejected',
  subject_kind: 'action_plan',
  payload: ActionPlanRejectedPayload,
});

export const TopicActionPlanModificationRequested = defineEvent({
  event_type: 'topic.action_plan.modification_requested',
  subject_template: 'events.topic.action_plan.modification_requested',
  subject_kind: 'action_plan',
  payload: ActionPlanModificationRequestedPayload,
});

export const TopicActionPlanExecuted = defineEvent({
  event_type: 'topic.action_plan.executed',
  subject_template: 'events.topic.action_plan.executed',
  subject_kind: 'action_plan',
  payload: ActionPlanExecutedPayload,
});

export const TopicActionPlanFailed = defineEvent({
  event_type: 'topic.action_plan.failed',
  subject_template: 'events.topic.action_plan.failed',
  subject_kind: 'action_plan',
  payload: ActionPlanFailedPayload,
});
