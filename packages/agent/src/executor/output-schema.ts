import { z } from 'zod';
import type { ActionPlan } from '../shared/action-plan';

export const ExecutorStatus = z.enum(['done', 'partial', 'failed']);
export type ExecutorStatus = z.infer<typeof ExecutorStatus>;

export const ExecutorOutput = z.object({
  status: ExecutorStatus,
  created: z.record(
    z.string(),
    z.object({
      record_id: z.string(),
      jira_key: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
});
export type ExecutorOutput = z.infer<typeof ExecutorOutput>;

export const EXECUTOR_ID = 'llm:executor:v1';

export interface ExecutorInput {
  topicId: string;
  actionPlanId: string;
  plan: ActionPlan;
}

export function fallbackExecutorOutput(_: ExecutorInput, reason: string): ExecutorOutput {
  return {
    status: 'failed',
    created: {},
    error: `executor fallback: ${reason}`,
  };
}
