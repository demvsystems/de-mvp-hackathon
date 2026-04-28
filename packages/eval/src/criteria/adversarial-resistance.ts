import type { Criterion } from './types';

export const adversarialResistance: Criterion = ({ config }) => {
  return {
    criterion: config.id,
    score: 0,
    notes: 'stub: not yet implemented',
  };
};
