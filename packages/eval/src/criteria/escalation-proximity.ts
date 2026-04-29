import type { Criterion } from './types';

export const escalationProximity: Criterion = ({ fixture, output, config }) => {
  const expected = fixture.expected.escalation_score;
  const actual = output.escalation_score;
  const diff = Math.abs(actual - expected);
  const threshold = Math.max(0, Math.min(1, config.threshold ?? 0.2));

  const score =
    diff <= threshold || threshold === 1
      ? 1
      : Math.max(0, 1 - (diff - threshold) / (1 - threshold));

  return {
    criterion: config.id,
    score,
    notes: `expected=${expected.toFixed(2)} actual=${actual.toFixed(2)} diff=${diff.toFixed(
      2,
    )} threshold=${threshold.toFixed(2)}`,
  };
};
