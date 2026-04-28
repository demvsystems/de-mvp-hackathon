import type { Criterion } from './types';

export const characterMatch: Criterion = ({ fixture, output, config }) => {
  const expected = fixture.expected.character;
  const actual = output.character;
  const score = expected === actual ? 1 : 0;
  return {
    criterion: config.id,
    score,
    notes: `expected=${expected} actual=${actual}`,
  };
};
