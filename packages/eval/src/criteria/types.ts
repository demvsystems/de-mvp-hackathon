import type { ToolCallRecord } from '@repo/agent-core';
import type { AssessmentOutput } from '@repo/llm-reviewer/output-schema';
import type { CriterionConfig } from '../rubric';
import type { Fixture } from '../fixture';

export interface CriterionInput {
  readonly fixture: Fixture;
  readonly output: AssessmentOutput;
  readonly toolCalls: ToolCallRecord[];
  readonly config: CriterionConfig;
}

export interface CriterionScore {
  readonly criterion: string;
  readonly score: number;
  readonly notes?: string;
}

export type Criterion = (input: CriterionInput) => Promise<CriterionScore> | CriterionScore;
