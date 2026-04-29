import {
  applyLangfuseTraceContext,
  ensureLangfuseTracing,
  flushLangfuse,
  getDefaultLangfuseClient,
  shutdownLangfuse as shutdownSharedLangfuse,
} from '@repo/agent';
import type { PromptResolution } from '@repo/agent';
import { type LangfuseEvaluator, startObservation } from '@langfuse/tracing';
import type { CriterionScore } from './criteria';

export function getLangfuse() {
  return getDefaultLangfuseClient();
}

export interface FixtureTraceInput {
  readonly fixtureId: string;
  readonly category: string;
  readonly rubricVersion: string;
  readonly prompt?: PromptResolution;
}

export interface FixtureTraceHandle {
  readonly score: (s: CriterionScore) => void;
  readonly setOutput: (output: unknown) => void;
  readonly end: () => Promise<void>;
}

export function startFixtureTrace(input: FixtureTraceInput): FixtureTraceHandle {
  const lf = getLangfuse();
  const tracingEnabled = ensureLangfuseTracing();
  if (!lf || !tracingEnabled) {
    return {
      score: () => undefined,
      setOutput: () => undefined,
      end: async () => undefined,
    };
  }

  const trace: LangfuseEvaluator = startObservation(
    'eval.fixture',
    {
      input: { fixtureId: input.fixtureId, category: input.category },
      metadata: {
        rubricVersion: input.rubricVersion,
        ...(input.prompt ? { prompt: input.prompt } : {}),
      },
    },
    { asType: 'evaluator' },
  );
  applyLangfuseTraceContext(trace, {
    traceName: 'eval.fixture',
    tags: [
      'eval',
      `category:${input.category}`,
      ...(input.prompt?.version !== null && input.prompt?.version !== undefined
        ? [`prompt-version:${input.prompt.version}`]
        : []),
    ],
    metadata: {
      fixture_id: input.fixtureId,
      category: input.category,
      rubric_version: input.rubricVersion,
      ...(input.prompt ? { prompt: input.prompt } : {}),
    },
  });
  trace.setTraceIO({ input: { fixtureId: input.fixtureId, category: input.category } });

  return {
    score: (s) =>
      lf.score.trace(
        { otelSpan: trace.otelSpan },
        {
          name: s.criterion,
          value: s.score,
          ...(s.notes !== undefined ? { comment: s.notes } : {}),
        },
      ),
    setOutput: (output) => {
      trace.update({ output });
      trace.setTraceIO({ output });
    },
    end: async () => {
      trace.end();
      await flushLangfuse();
    },
  };
}

export async function shutdownLangfuse(): Promise<void> {
  await shutdownSharedLangfuse();
}
