import { runAgent, type AgentCallOptions, type AgentResult } from '../core';
import { ExecutorOutput, fallbackExecutorOutput, type ExecutorInput } from './output-schema';
import { buildExecutorUserPrompt, EXECUTOR_SYSTEM_PROMPT } from './prompt';
import { executorTools, getCreatedRecordIds, makeExecutorContext } from './tools';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const model = process.env['LLM_EXECUTOR_MODEL'] ?? DEFAULT_MODEL;

export interface ExecutorRunResult {
  result: AgentResult<ExecutorOutput>;
  createdRecordIds: readonly string[];
}

export async function executorAgent(
  input: ExecutorInput,
  options?: AgentCallOptions,
): Promise<ExecutorRunResult> {
  const ctx = makeExecutorContext(input.topicId, input.actionPlanId);
  const tools = executorTools(ctx);
  const result = await runAgent(
    {
      name: 'llm-executor',
      model,
      systemPrompt: EXECUTOR_SYSTEM_PROMPT,
      userPrompt: buildExecutorUserPrompt,
      tools,
      outputSchema: ExecutorOutput,
      fallback: fallbackExecutorOutput,
      maxTurns: 12,
      temperature: 0,
      observability: {
        traceName: 'llm-executor.execute-plan',
        traceInput: (i) => ({ topic_id: i.topicId, action_plan_id: i.actionPlanId }),
        sessionId: (i) => i.topicId,
        tags: () => ['feature:action-plan-execution'],
        metadata: (i) => ({
          feature: 'action-plan-execution',
          action_plan_id: i.actionPlanId,
          action_count: i.plan.actions.length,
        }),
      },
      ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
    },
    input,
  );
  return { result, createdRecordIds: getCreatedRecordIds(ctx) };
}
