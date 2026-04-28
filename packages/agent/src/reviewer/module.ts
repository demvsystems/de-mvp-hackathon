import {
  publish,
  TopicAssessmentCreated,
  TopicCreated,
  TopicUpdated,
  type ConsumerOptions,
  type MessageContext,
  type Subscriber,
} from '@repo/messaging';
import { reviewerAgent } from './agent';
import { ASSESSOR_ID } from './output-schema';

const REVIEWER_FILTER_SUBJECT = process.env['LLM_REVIEWER_FILTER'] ?? 'events.topic.>';

async function reviewAndPublish(
  topicId: string,
  ctx: MessageContext,
  triggeredBy: string,
): Promise<void> {
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      msg: 'reviewer started',
      topic_id: topicId,
      triggered_by: triggeredBy,
      causation_event_id: ctx.envelope.event_id,
    }),
  );

  const result = await reviewerAgent({ topicId, triggeredBy });
  const assessedAt = new Date().toISOString();

  const ack = await publish(TopicAssessmentCreated, {
    source: ASSESSOR_ID,
    occurred_at: assessedAt,
    subject_id: `assessment:${topicId}:${ASSESSOR_ID}:${assessedAt}`,
    causation_id: ctx.envelope.event_id,
    correlation_id: topicId,
    payload: {
      topic_id: topicId,
      assessor: ASSESSOR_ID,
      assessed_at: assessedAt,
      character: result.output.character,
      escalation_score: result.output.escalation_score,
      reasoning: {
        summary: result.output.summary,
        key_signals: result.output.reasoning.key_signals,
        key_artifacts: result.output.reasoning.key_artifacts,
        ...(result.output.reasoning.additional_notes !== undefined
          ? { additional_notes: result.output.reasoning.additional_notes }
          : {}),
      },
      triggered_by: triggeredBy,
    },
  });

  console.log(
    JSON.stringify({
      msg: 'reviewer published',
      topic_id: topicId,
      character: result.output.character,
      escalation_score: result.output.escalation_score,
      turns: result.metadata.turns,
      fallback_reason: result.metadata.fallback_reason,
      prompt_name: result.metadata.prompt.name,
      prompt_version: result.metadata.prompt.version,
      prompt_label: result.metadata.prompt.label,
      prompt_from_fallback: result.metadata.prompt.from_fallback,
      trace_id: result.metadata.trace_id,
      trace_url: result.metadata.trace_url,
      duration_ms: Date.now() - startedAt,
      assessment_event_id: ack.event_id,
      duplicate: ack.duplicate,
    }),
  );
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
        await reviewAndPublish(payload.id, ctx, TopicCreated.event_type);
      })
      .on(TopicUpdated, async (payload, ctx) => {
        await reviewAndPublish(payload.id, ctx, TopicUpdated.event_type);
      });
  },
};
