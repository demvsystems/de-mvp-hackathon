import { defineAgent } from '@repo/agent-core';
import { AssessmentOutput, fallbackAssessment, type ReviewerInput } from './output-schema';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import { reviewerTools } from './tools';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const model = process.env['LLM_REVIEWER_MODEL'] ?? DEFAULT_MODEL;

export const reviewerAgent = defineAgent<ReviewerInput, AssessmentOutput>({
  name: 'llm-reviewer',
  model,
  systemPrompt: SYSTEM_PROMPT,
  userPrompt: buildUserPrompt,
  tools: reviewerTools,
  outputSchema: AssessmentOutput,
  fallback: fallbackAssessment,
  maxTurns: 6,
  temperature: 0,
});
