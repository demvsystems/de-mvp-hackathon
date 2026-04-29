import type Anthropic from '@anthropic-ai/sdk';
import { db, eq, read, schema, sql } from '@repo/db';
import { publishWithPersist } from '@repo/materializer';
import {
  publish,
  publishCore,
  TopicActionPlanModificationRequested,
  TopicActionPlanProposed,
  TopicAssessmentCreated,
  TopicCreated,
  TopicUpdated,
  type ConsumerOptions,
  type MessageContext,
  type Subscriber,
} from '@repo/messaging';
import type { AgentEvent, AgentEventListener } from '../core';
import {
  ActionPlan,
  DEFAULT_PLAYBOOK,
  Playbook,
  PLAYBOOK_ID,
  analyzeEvidenceRecord,
  collectActionPlanRecordIds,
  isSuspiciousRecord,
  type GuardrailEvent,
  validateAssessmentOutput,
} from '../shared';
import { reviewerAgent } from './agent';
import { DEFAULT_ACTION_PLAN_FEW_SHOTS } from './few-shot';
import { ASSESSOR_ID, fallbackAssessment, type ReviewerInput } from './output-schema';
import { buildModifyContinuationPrompt } from './prompt';

async function topicExists(topicId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM topics WHERE id = ${topicId} AND status = 'active' LIMIT 1
  `;
  return rows.length > 0;
}

async function loadPlaybook(): Promise<Playbook | undefined> {
  const rows = await db
    .select({ playbook: schema.companyPlaybook.playbook })
    .from(schema.companyPlaybook)
    .where(eq(schema.companyPlaybook.id, PLAYBOOK_ID))
    .limit(1);
  if (rows.length === 0) {
    await db.insert(schema.companyPlaybook).values({
      id: PLAYBOOK_ID,
      playbook: DEFAULT_PLAYBOOK as unknown,
      version: 1,
      updatedBy: 'system:default',
    });
    return DEFAULT_PLAYBOOK;
  }
  const parsed = Playbook.safeParse(rows[0]!.playbook);
  if (!parsed.success) {
    console.warn(
      JSON.stringify({
        msg: 'reviewer playbook invalid, ignoring',
        issues: parsed.error.issues,
      }),
    );
    return DEFAULT_PLAYBOOK;
  }
  return parsed.data;
}

const REVIEWER_FILTER_SUBJECT = process.env['LLM_REVIEWER_FILTER'] ?? 'events.topic.>';

// Minimum wall-clock spacing between review *starts*. Keeps LLM rate sane and
// makes the dashboard's review activity visible at human speed during demos.
// Override via env if needed.
const REVIEWER_MIN_INTERVAL_MS = Number(process.env['REVIEWER_MIN_INTERVAL_MS'] ?? 10_000);

let nextSlotAt = 0;
async function reserveReviewSlot(): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + REVIEWER_MIN_INTERVAL_MS;
  const wait = startAt - now;
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const ACTIVITY_SUBJECT_PREFIX = 'reviewer.activity';

interface ActivityEnvelope {
  readonly topic_id: string;
  readonly triggered_by: string;
  readonly emitted_at: string;
  readonly event: AgentEvent;
}

function buildActivityListener(topicId: string, triggeredBy: string): AgentEventListener {
  const subject = `${ACTIVITY_SUBJECT_PREFIX}.${topicId}`;
  return (event) => {
    const envelope: ActivityEnvelope = {
      topic_id: topicId,
      triggered_by: triggeredBy,
      emitted_at: new Date().toISOString(),
      event,
    };
    publishCore(subject, envelope).catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          msg: 'reviewer activity publish failed',
          topic_id: topicId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };
}

function collectReferencedRecordIds(
  output: Awaited<ReturnType<typeof reviewerAgent>>['output'],
): string[] {
  return unique([
    ...output.summary.covers_record_ids,
    ...output.reasoning.key_artifacts,
    ...collectActionPlanRecordIds(output.recommended_action_plan),
  ]);
}

async function loadGuardrailContext(
  topicId: string,
  output: Awaited<ReturnType<typeof reviewerAgent>>['output'],
): Promise<{ allowedRecordIds: string[]; suspiciousRecordIds: string[] }> {
  const referencedIds = collectReferencedRecordIds(output);
  if (referencedIds.length === 0) {
    return { allowedRecordIds: [], suspiciousRecordIds: [] };
  }

  const rows = await read.getRecords({
    ids: referencedIds,
    topic_id: topicId,
    sort_by: 'created_at',
    order: 'desc',
    limit: referencedIds.length,
  });

  return {
    allowedRecordIds: rows.map((row) => row.id),
    suspiciousRecordIds: rows
      .filter((row) => isSuspiciousRecord(analyzeEvidenceRecord(row)))
      .map((row) => row.id),
  };
}

async function persistGuardrailEvents(args: {
  topicId: string;
  assessedAt: string;
  traceId: string | null;
  events: readonly GuardrailEvent[];
}): Promise<void> {
  const actionable = args.events.filter((event) => event.decision !== 'allow');
  for (const event of actionable) {
    await db.insert(schema.guardrailEvents).values({
      topicId: args.topicId,
      assessor: ASSESSOR_ID,
      assessedAt: new Date(args.assessedAt),
      traceId: args.traceId,
      stage: event.stage,
      ruleId: event.rule_id,
      severity: event.severity,
      decision: event.decision,
      detail: event.detail,
      recordIds: event.record_ids,
    });
  }
}

async function persistAssessmentAndPlan(args: {
  topicId: string;
  triggeredBy: string;
  causationEventId: string;
  result: Awaited<ReturnType<typeof reviewerAgent>>;
  supersedesId: string | null;
  playbook?: Playbook;
}): Promise<{ planId: string | null; sessionId: string }> {
  const { topicId, triggeredBy, causationEventId, result, supersedesId, playbook } = args;
  const assessedAt = new Date().toISOString();
  const guardrailContext = await loadGuardrailContext(topicId, result.output);
  const guarded = validateAssessmentOutput({
    output: result.output,
    allowedRecordIds: guardrailContext.allowedRecordIds,
    suspiciousRecordIds: guardrailContext.suspiciousRecordIds,
    toolCalls: result.metadata.tool_calls,
    playbook,
  });
  const finalOutput =
    guarded.decision === 'block'
      ? fallbackAssessment(
          { topicId, triggeredBy, ...(playbook ? { playbook } : {}) },
          `guardrail blocked output (${guarded.fallbackReason ?? 'unknown'})`,
        )
      : guarded.sanitized;

  const shouldPublishTopicMetadata =
    result.metadata.fallback_reason === null && guarded.decision !== 'block';

  await persistGuardrailEvents({
    topicId,
    assessedAt,
    traceId: result.metadata.trace_id,
    events: guarded.events,
  });

  const sessionRow = await db
    .insert(schema.reviewerSessions)
    .values({
      topicId,
      assessor: ASSESSOR_ID,
      model: process.env['LLM_REVIEWER_MODEL'] ?? 'claude-sonnet-4-6',
      messages: result.messages as unknown,
    })
    .returning({ id: schema.reviewerSessions.id });
  const sessionId = sessionRow[0]!.id;

  if (shouldPublishTopicMetadata) {
    await publishWithPersist(TopicUpdated, {
      source: ASSESSOR_ID,
      occurred_at: assessedAt,
      subject_id: topicId,
      causation_id: causationEventId,
      correlation_id: topicId,
      payload: {
        id: topicId,
        label: finalOutput.topic.label,
        description: finalOutput.topic.description,
        centroid: null,
        member_count: null,
      },
    });
  }

  // publishWithPersist writes the `topic_assessments` row before publishing,
  // so any subscriber that sees the event also sees the row.
  const assessmentAck = await publishWithPersist(TopicAssessmentCreated, {
    source: ASSESSOR_ID,
    occurred_at: assessedAt,
    subject_id: `assessment:${topicId}:${ASSESSOR_ID}:${assessedAt}`,
    causation_id: causationEventId,
    correlation_id: topicId,
    payload: {
      topic_id: topicId,
      assessor: ASSESSOR_ID,
      assessed_at: assessedAt,
      character: finalOutput.character,
      escalation_score: finalOutput.escalation_score,
      reasoning: {
        summary: finalOutput.summary,
        ...(finalOutput.reasoning.tldr !== undefined ? { tldr: finalOutput.reasoning.tldr } : {}),
        key_signals: finalOutput.reasoning.key_signals,
        key_artifacts: finalOutput.reasoning.key_artifacts,
        ...(finalOutput.reasoning.additional_notes !== undefined
          ? { additional_notes: finalOutput.reasoning.additional_notes }
          : {}),
      },
      triggered_by: triggeredBy,
      trace_id: result.metadata.trace_id,
    },
  });

  let planId: string | null = null;
  if (finalOutput.recommended_action_plan) {
    const plan = finalOutput.recommended_action_plan;
    const inserted = await db
      .insert(schema.topicActionPlans)
      .values({
        topicId,
        sessionId,
        supersedesId,
        status: 'proposed',
        plan: plan as unknown,
        rationale: plan.rationale,
      })
      .returning({ id: schema.topicActionPlans.id });
    planId = inserted[0]!.id;

    await publish(TopicActionPlanProposed, {
      source: ASSESSOR_ID,
      occurred_at: assessedAt,
      subject_id: `action_plan:${planId}`,
      causation_id: causationEventId,
      correlation_id: topicId,
      payload: {
        topic_id: topicId,
        action_plan_id: planId,
        session_id: sessionId,
        supersedes_id: supersedesId,
        proposed_at: assessedAt,
        rationale: plan.rationale,
        action_count: plan.actions.length,
      },
    });
  }

  console.log(
    JSON.stringify({
      msg: 'reviewer published',
      topic_id: topicId,
      character: finalOutput.character,
      escalation_score: finalOutput.escalation_score,
      action_plan_id: planId,
      action_count: finalOutput.recommended_action_plan?.actions.length ?? 0,
      turns: result.metadata.turns,
      fallback_reason: result.metadata.fallback_reason,
      guardrail_decision: guarded.decision,
      guardrail_events: guarded.events.length,
      trace_id: result.metadata.trace_id,
      assessment_event_id: assessmentAck.event_id,
    }),
  );

  return { planId, sessionId };
}

async function reviewAndPublish(
  topicId: string,
  ctx: MessageContext,
  triggeredBy: string,
): Promise<void> {
  await reserveReviewSlot();
  console.log(
    JSON.stringify({
      msg: 'reviewer started',
      topic_id: topicId,
      triggered_by: triggeredBy,
      causation_event_id: ctx.envelope.event_id,
    }),
  );

  const playbook = await loadPlaybook();
  const input: ReviewerInput = {
    topicId,
    triggeredBy,
    fewShotExamples: DEFAULT_ACTION_PLAN_FEW_SHOTS,
    ...(playbook ? { playbook } : {}),
  };

  const result = await reviewerAgent(input, undefined, {
    onEvent: buildActivityListener(topicId, triggeredBy),
  });

  await persistAssessmentAndPlan({
    topicId,
    triggeredBy,
    causationEventId: ctx.envelope.event_id,
    result,
    supersedesId: null,
    ...(playbook ? { playbook } : {}),
  });
}

async function modifyPlan(
  args: { topicId: string; planId: string; feedback: string; requestedBy: string | null },
  ctx: MessageContext,
): Promise<void> {
  const { topicId, planId, feedback, requestedBy } = args;

  const planRows = await db
    .select({
      id: schema.topicActionPlans.id,
      sessionId: schema.topicActionPlans.sessionId,
      plan: schema.topicActionPlans.plan,
      status: schema.topicActionPlans.status,
    })
    .from(schema.topicActionPlans)
    .where(eq(schema.topicActionPlans.id, planId))
    .limit(1);
  if (planRows.length === 0) {
    console.warn(JSON.stringify({ msg: 'modify: plan not found', plan_id: planId }));
    return;
  }
  const planRow = planRows[0]!;
  if (planRow.status !== 'proposed') {
    console.warn(
      JSON.stringify({
        msg: 'modify: plan not in proposed state, skipping',
        plan_id: planId,
        status: planRow.status,
      }),
    );
    return;
  }

  const priorPlanParsed = ActionPlan.safeParse(planRow.plan);
  if (!priorPlanParsed.success) {
    console.warn(JSON.stringify({ msg: 'modify: prior plan invalid', plan_id: planId }));
    return;
  }

  const sessionRows = await db
    .select({ messages: schema.reviewerSessions.messages })
    .from(schema.reviewerSessions)
    .where(eq(schema.reviewerSessions.id, planRow.sessionId))
    .limit(1);
  if (sessionRows.length === 0) {
    console.warn(JSON.stringify({ msg: 'modify: session not found', plan_id: planId }));
    return;
  }
  const priorMessages = sessionRows[0]!.messages as Anthropic.Messages.MessageParam[];

  const playbook = await loadPlaybook();
  if (!playbook) {
    console.warn(JSON.stringify({ msg: 'modify: no playbook configured, aborting' }));
    return;
  }

  // Mark old plan superseded with feedback recorded.
  const decisionAt = new Date();
  await db
    .update(schema.topicActionPlans)
    .set({
      status: 'superseded',
      decisionKind: 'modify',
      decisionAt,
      decisionBy: requestedBy,
      modificationFeedback: feedback,
    })
    .where(eq(schema.topicActionPlans.id, planId));

  const continuation = buildModifyContinuationPrompt({
    priorPlan: priorPlanParsed.data,
    feedback,
    playbook,
  });

  const result = await reviewerAgent(
    {
      topicId,
      triggeredBy: 'modify',
      playbook,
      fewShotExamples: DEFAULT_ACTION_PLAN_FEW_SHOTS,
    },
    {
      priorMessages,
      nextUserMessage: continuation,
    },
    {
      onEvent: buildActivityListener(topicId, `modify:${planId}`),
    },
  );

  // Update session with the extended messages array.
  await db
    .update(schema.reviewerSessions)
    .set({ messages: result.messages as unknown, updatedAt: new Date() })
    .where(eq(schema.reviewerSessions.id, planRow.sessionId));

  await persistAssessmentAndPlan({
    topicId,
    triggeredBy: `modify:${planId}`,
    causationEventId: ctx.envelope.event_id,
    result,
    supersedesId: planId,
    playbook,
  });
}

export const agentReviewerModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'llm-assessor',
    filter_subject: REVIEWER_FILTER_SUBJECT,
    deliver_policy: 'all',
  },
  register(sub) {
    sub
      .on(TopicCreated, async (payload, ctx) => {
        if (!(await topicExists(payload.id))) return;
        await reviewAndPublish(payload.id, ctx, TopicCreated.event_type);
      })
      .on(TopicUpdated, async (payload, ctx) => {
        if (ctx.envelope.source === ASSESSOR_ID) return;
        if (!(await topicExists(payload.id))) return;
        await reviewAndPublish(payload.id, ctx, TopicUpdated.event_type);
      })
      .on(TopicActionPlanModificationRequested, async (payload, ctx) => {
        await modifyPlan(
          {
            topicId: payload.topic_id,
            planId: payload.action_plan_id,
            feedback: payload.feedback,
            requestedBy: payload.requested_by,
          },
          ctx,
        );
      });
  },
};
