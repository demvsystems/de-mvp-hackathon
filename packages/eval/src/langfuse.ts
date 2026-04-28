import { Langfuse } from 'langfuse';
import type { CriterionScore } from './criteria';

let cached: Langfuse | null | undefined;

export function getLangfuse(): Langfuse | null {
  if (cached !== undefined) return cached;

  const secret = process.env['LANGFUSE_SECRET_KEY'];
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  const host = process.env['LANGFUSE_HOST'];
  if (!secret || !publicKey) {
    cached = null;
    return cached;
  }

  cached = new Langfuse({
    secretKey: secret,
    publicKey,
    ...(host !== undefined ? { baseUrl: host } : {}),
  });
  return cached;
}

export interface FixtureTraceInput {
  readonly fixtureId: string;
  readonly category: string;
  readonly rubricVersion: string;
}

export interface FixtureTraceHandle {
  readonly score: (s: CriterionScore) => void;
  readonly setOutput: (output: unknown) => void;
  readonly end: () => Promise<void>;
}

export function startFixtureTrace(input: FixtureTraceInput): FixtureTraceHandle {
  const lf = getLangfuse();
  if (!lf) {
    return {
      score: () => undefined,
      setOutput: () => undefined,
      end: async () => undefined,
    };
  }

  const trace = lf.trace({
    name: 'eval.fixture',
    input: { fixtureId: input.fixtureId, category: input.category },
    metadata: { rubricVersion: input.rubricVersion },
    tags: ['eval', `category:${input.category}`],
  });

  return {
    score: (s) =>
      trace.score({
        name: s.criterion,
        value: s.score,
        ...(s.notes !== undefined ? { comment: s.notes } : {}),
      }),
    setOutput: (output) => trace.update({ output }),
    end: async () => {
      await lf.flushAsync();
    },
  };
}

export async function shutdownLangfuse(): Promise<void> {
  if (cached) {
    await cached.shutdownAsync();
  }
}
