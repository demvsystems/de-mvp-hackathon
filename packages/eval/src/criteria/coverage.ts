import type { Criterion } from './types';

export const coverage: Criterion = ({ fixture, output, config }) => {
  const expected = [...new Set(fixture.expected.anchor_record_ids)];
  if (expected.length === 0) {
    return {
      criterion: config.id,
      score: 1,
      notes: 'no expected anchor_record_ids declared; defaulting to pass',
    };
  }

  const covered = new Set(output.summary.covers_record_ids);
  const hits = expected.filter((id) => covered.has(id));
  const missing = expected.filter((id) => !covered.has(id));

  return {
    criterion: config.id,
    score: hits.length / expected.length,
    notes: `hits=${JSON.stringify(hits)} missing=${JSON.stringify(missing)}`,
  };
};
