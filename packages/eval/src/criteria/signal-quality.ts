import type { Criterion } from './types';

export const signalQuality: Criterion = ({ config }) => {
  return {
    criterion: config.id,
    score: 0,
    notes: 'stub: LLM-judge not yet implemented',
  };
};
