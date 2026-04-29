import { judge } from '../judge';
import { averageBestOverlap } from './heuristics';
import type { Criterion } from './types';

function shouldUseJudge(): boolean {
  return process.env['EVAL_USE_LLM_JUDGE'] === '1';
}

export const signalQuality: Criterion = async ({ fixture, output, config }) => {
  const expected = fixture.expected.expected_signals;
  const actual = output.reasoning.key_signals;

  if (!shouldUseJudge()) {
    const score = averageBestOverlap(expected, actual);
    return {
      criterion: config.id,
      score,
      notes: `heuristic fallback expected=${expected.length} actual=${actual.length}`,
    };
  }

  const verdict = await judge({
    ...(config.judge_model ? { model: config.judge_model } : {}),
    system:
      'Score whether the actual key signals cover the same themes as the expected key signals. Return JSON {"score": number, "notes": string}. Score 1 means theme-complete overlap, 0 means unrelated or misleading.',
    user: JSON.stringify({
      expected_signals: expected,
      actual_key_signals: actual,
    }),
  });

  return {
    criterion: config.id,
    score: verdict.score,
    ...(verdict.notes ? { notes: verdict.notes } : {}),
  };
};
