import { db, eq, schema } from '@repo/db';
import {
  publish,
  TopicActionPlanApproved,
  TopicActionPlanExecuted,
  TopicActionPlanFailed,
  type ConsumerOptions,
  type MessageContext,
  type Subscriber,
} from '@repo/messaging';
import { ActionPlan } from '../shared/action-plan';
import { executorAgent } from './agent';
import { EXECUTOR_ID } from './output-schema';

const FILTER_SUBJECT = process.env['LLM_EXECUTOR_FILTER'] ?? 'events.topic.action_plan.>';

async function executeApprovedPlan(
  args: { topicId: string; planId: string },
  ctx: MessageContext,
): Promise<void> {
  const { topicId, planId } = args;
  const runId = `${EXECUTOR_ID}:${planId}:${Date.now()}`;

  const planRows = await db
    .select({
      id: schema.topicActionPlans.id,
      plan: schema.topicActionPlans.plan,
      status: schema.topicActionPlans.status,
    })
    .from(schema.topicActionPlans)
    .where(eq(schema.topicActionPlans.id, planId))
    .limit(1);
  if (planRows.length === 0) {
    console.warn(JSON.stringify({ msg: 'executor: plan not found', plan_id: planId }));
    return;
  }
  const planRow = planRows[0]!;
  if (planRow.status !== 'approved') {
    console.warn(
      JSON.stringify({
        msg: 'executor: plan not in approved state, skipping',
        plan_id: planId,
        status: planRow.status,
      }),
    );
    return;
  }

  const planParsed = ActionPlan.safeParse(planRow.plan);
  if (!planParsed.success) {
    console.warn(JSON.stringify({ msg: 'executor: plan invalid', plan_id: planId }));
    return;
  }

  await db
    .update(schema.topicActionPlans)
    .set({ status: 'executing', executorRunId: runId })
    .where(eq(schema.topicActionPlans.id, planId));

  console.log(
    JSON.stringify({
      msg: 'executor started',
      topic_id: topicId,
      action_plan_id: planId,
      run_id: runId,
      action_count: planParsed.data.actions.length,
    }),
  );

  try {
    const { result, createdRecordIds } = await executorAgent({
      topicId,
      actionPlanId: planId,
      plan: planParsed.data,
    });

    if (result.output.status === 'failed') {
      await db
        .update(schema.topicActionPlans)
        .set({
          status: 'failed',
          error: result.output.error ?? 'executor reported failed',
          createdRecords: createdRecordIds as unknown,
        })
        .where(eq(schema.topicActionPlans.id, planId));

      const failedAt = new Date().toISOString();
      await publish(TopicActionPlanFailed, {
        source: EXECUTOR_ID,
        occurred_at: failedAt,
        subject_id: `action_plan:${planId}`,
        causation_id: ctx.envelope.event_id,
        correlation_id: topicId,
        payload: {
          topic_id: topicId,
          action_plan_id: planId,
          failed_at: failedAt,
          executor_run_id: runId,
          error: result.output.error ?? 'failed',
        },
      });
      return;
    }

    const executedAt = new Date().toISOString();
    await db
      .update(schema.topicActionPlans)
      .set({
        status: 'executed',
        executedAt: new Date(executedAt),
        createdRecords: createdRecordIds as unknown,
      })
      .where(eq(schema.topicActionPlans.id, planId));

    await publish(TopicActionPlanExecuted, {
      source: EXECUTOR_ID,
      occurred_at: executedAt,
      subject_id: `action_plan:${planId}`,
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
      payload: {
        topic_id: topicId,
        action_plan_id: planId,
        executed_at: executedAt,
        executor_run_id: runId,
        created_record_ids: [...createdRecordIds],
      },
    });

    console.log(
      JSON.stringify({
        msg: 'executor finished',
        topic_id: topicId,
        action_plan_id: planId,
        run_id: runId,
        status: result.output.status,
        created_record_count: createdRecordIds.length,
        turns: result.metadata.turns,
      }),
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.topicActionPlans)
      .set({ status: 'failed', error: errorMsg })
      .where(eq(schema.topicActionPlans.id, planId));

    const failedAt = new Date().toISOString();
    await publish(TopicActionPlanFailed, {
      source: EXECUTOR_ID,
      occurred_at: failedAt,
      subject_id: `action_plan:${planId}`,
      causation_id: ctx.envelope.event_id,
      correlation_id: topicId,
      payload: {
        topic_id: topicId,
        action_plan_id: planId,
        failed_at: failedAt,
        executor_run_id: runId,
        error: errorMsg,
      },
    });
    throw err;
  }
}

export const agentExecutorModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'llm-executor',
    filter_subject: FILTER_SUBJECT,
    deliver_policy: 'all',
  },
  register(sub) {
    sub.on(TopicActionPlanApproved, async (payload, ctx) => {
      await executeApprovedPlan({ topicId: payload.topic_id, planId: payload.action_plan_id }, ctx);
    });
  },
};
