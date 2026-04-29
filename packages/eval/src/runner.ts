import type { AgentRunMetadata, PromptResolution, ToolCallRecord } from '@repo/agent';
import type { AssessmentOutput } from '@repo/agent/reviewer';
import { criteriaRegistry, type CriterionScore } from './criteria';
import type { Fixture } from './fixture';
import { startFixtureTrace } from './langfuse';
import type { RubricConfig } from './rubric';

export interface FixtureReport {
  readonly fixtureId: string;
  readonly category: string;
  readonly weighted_score: number;
  readonly passed: boolean;
  readonly criteria: CriterionScore[];
  readonly tool_calls: ToolCallRecord[];
  readonly prompt: PromptResolution | null;
}

function applies(category: string, criterionApplies: string[] | undefined): boolean {
  if (!criterionApplies || criterionApplies.length === 0) return true;
  return criterionApplies.includes(category);
}

export async function scoreFixture(
  fixture: Fixture,
  output: AssessmentOutput,
  toolCalls: ToolCallRecord[],
  rubric: RubricConfig,
  metadata?: Pick<AgentRunMetadata, 'prompt'>,
): Promise<FixtureReport> {
  const trace = startFixtureTrace({
    fixtureId: fixture.id,
    category: fixture.category,
    rubricVersion: rubric.version,
    ...(metadata?.prompt ? { prompt: metadata.prompt } : {}),
  });
  trace.setOutput({ assessment: output, tool_calls: toolCalls });

  const scores: CriterionScore[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const cfg of rubric.criteria) {
    if (!applies(fixture.category, cfg.applies_to_categories)) continue;
    const fn = criteriaRegistry[cfg.id];
    if (!fn) {
      const missing: CriterionScore = {
        criterion: cfg.id,
        score: 0,
        notes: `unknown criterion id: ${cfg.id}`,
      };
      scores.push(missing);
      trace.score(missing);
      continue;
    }
    const result = await fn({ fixture, output, toolCalls, config: cfg });
    scores.push(result);
    trace.score(result);
    weightedSum += result.score * cfg.weight;
    weightTotal += cfg.weight;
  }

  const weighted_score = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  const passed = weighted_score >= rubric.pass_threshold;

  await trace.end();

  return {
    fixtureId: fixture.id,
    category: fixture.category,
    weighted_score,
    passed,
    criteria: scores,
    tool_calls: toolCalls,
    prompt: metadata?.prompt ?? null,
  };
}
