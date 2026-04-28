import { AssessmentCharacter } from '@repo/messaging';
import { z } from 'zod';

export const AssessmentSummary = z.object({
  text: z.string().min(1).max(4000),
  covers_record_ids: z.array(z.string()),
});
export type AssessmentSummary = z.infer<typeof AssessmentSummary>;

export const AssessmentReasoning = z.object({
  key_signals: z.array(z.string()).min(1).max(7),
  key_artifacts: z.array(z.string()),
  additional_notes: z.string().optional(),
});
export type AssessmentReasoning = z.infer<typeof AssessmentReasoning>;

export const AssessmentOutput = z.object({
  character: AssessmentCharacter,
  escalation_score: z.number().min(0).max(1),
  summary: AssessmentSummary,
  reasoning: AssessmentReasoning,
});
export type AssessmentOutput = z.infer<typeof AssessmentOutput>;

export const ASSESSOR_ID = 'llm:claude:v1';

export interface ReviewerInput {
  topicId: string;
  triggeredBy: string;
}

export function fallbackAssessment(input: ReviewerInput, reason: string): AssessmentOutput {
  return {
    character: 'noteworthy',
    escalation_score: 0.5,
    summary: {
      text: `Auto-fallback assessment for topic ${input.topicId}: ${reason}`,
      covers_record_ids: [],
    },
    reasoning: {
      key_signals: [`auto-fallback (${reason})`],
      key_artifacts: [],
      additional_notes:
        'fallback emitted by llm-reviewer because the agent run did not produce a valid assessment',
    },
  };
}
