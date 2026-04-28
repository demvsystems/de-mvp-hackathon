import type { Criterion } from './types';

export const summaryFaithfulness: Criterion = ({ config }) => {
  return {
    criterion: config.id,
    score: 0,
    notes: 'stub: LLM-judge not yet implemented',
  };
};
