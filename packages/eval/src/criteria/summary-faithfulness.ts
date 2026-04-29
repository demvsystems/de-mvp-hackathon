import { judge } from '../judge';
import { overlapScore } from './heuristics';
import type { Criterion } from './types';

function shouldUseJudge(): boolean {
  return process.env['EVAL_USE_LLM_JUDGE'] === '1';
}

export const summaryFaithfulness: Criterion = async ({ fixture, output, config }) => {
  const corpus = fixture.records
    .map((record) =>
      [record.title ?? '', record.body ?? ''].filter((part) => part.length > 0).join('\n'),
    )
    .filter((text) => text.length > 0)
    .join('\n');

  if (!shouldUseJudge()) {
    const score = overlapScore(output.summary.text, corpus);
    return {
      criterion: config.id,
      score,
      notes: 'heuristic fallback based on summary token support in fixture records',
    };
  }

  const verdict = await judge({
    ...(config.judge_model ? { model: config.judge_model } : {}),
    system:
      'Score whether the summary is faithful to the provided records. Return JSON {"score": number, "notes": string}. Score 1 means the summary is fully supported and non-contradictory. Score 0 means it invents or contradicts material facts.',
    user: JSON.stringify({
      records: fixture.records.map((record) => ({
        id: record.id,
        title: record.title,
        body: record.body,
      })),
      summary: output.summary.text,
    }),
  });

  return {
    criterion: config.id,
    score: verdict.score,
    ...(verdict.notes ? { notes: verdict.notes } : {}),
  };
};
