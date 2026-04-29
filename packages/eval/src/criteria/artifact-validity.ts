import type { Criterion } from './types';

export const artifactValidity: Criterion = ({ fixture, output, config }) => {
  const artifacts = output.reasoning.key_artifacts;
  if (artifacts.length === 0) {
    return {
      criterion: config.id,
      score: 1,
      notes: 'no key_artifacts cited; defaulting to pass',
    };
  }

  const validIds = new Set(fixture.records.map((record) => record.id));
  const valid = artifacts.filter((id) => validIds.has(id));
  const invalid = artifacts.filter((id) => !validIds.has(id));

  return {
    criterion: config.id,
    score: valid.length / artifacts.length,
    notes: `valid=${JSON.stringify(valid)} invalid=${JSON.stringify(invalid)}`,
  };
};
