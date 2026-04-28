import { defineAgent } from '../core';
import { AssessmentOutput, fallbackAssessment, type ReviewerInput } from './output-schema';
import { buildUserPrompt, SYSTEM_PROMPT_FALLBACK } from './prompt';
import { reviewerTools } from './tools';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const model = process.env['LLM_REVIEWER_MODEL'] ?? DEFAULT_MODEL;

export const REVIEWER_PROMPT_NAME = 'reviewer.system';
export const REVIEWER_PROMPT_LABEL = process.env['LLM_REVIEWER_PROMPT_LABEL'] ?? 'production';

export const reviewerAgent = defineAgent<ReviewerInput, AssessmentOutput>({
  name: 'llm-reviewer',
  model,
  systemPrompt: {
    kind: 'langfuse',
    name: REVIEWER_PROMPT_NAME,
    label: REVIEWER_PROMPT_LABEL,
    fallback: SYSTEM_PROMPT_FALLBACK,
  },
  userPrompt: buildUserPrompt,
  tools: reviewerTools,
  outputSchema: AssessmentOutput,
  fallback: fallbackAssessment,
  maxTurns: 6,
  temperature: 0,
  observability: {
    traceName: 'llm-reviewer.review-topic',
    traceInput: (input) => ({
      topic_id: input.topicId,
      triggered_by: input.triggeredBy,
    }),
    traceOutput: (output) => ({
      character: output.character,
      escalation_score: output.escalation_score,
      summary: output.summary,
      reasoning: output.reasoning,
    }),
    sessionId: (input) => input.topicId,
    tags: (input) => ['feature:topic-review', `trigger:${input.triggeredBy}`],
    metadata: (input) => ({
      feature: 'topic-review',
      triggered_by: input.triggeredBy,
      assessment_schema: 'AssessmentOutput.v1',
      prompt_label: REVIEWER_PROMPT_LABEL,
    }),
  },
});
