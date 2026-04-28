import { describe, expect, it } from 'vitest';
import {
  DISTANCE_THRESHOLD_BODY_ONLY,
  STRATEGY_BODY_ONLY,
  confidenceFromDistance,
  parseStrategy,
  vectorLiteral,
} from './cluster';

describe('parseStrategy', () => {
  it('extracts strategy from the embedder model_version layout', () => {
    expect(parseStrategy('openai-small-3:body-only:v1')).toBe('body-only');
    expect(parseStrategy('openai-small-3:with-neighbors:v1')).toBe('with-neighbors');
  });

  it('returns empty string for malformed model_version', () => {
    expect(parseStrategy('weird')).toBe('');
    expect(parseStrategy('')).toBe('');
  });

  it('STRATEGY_BODY_ONLY matches what parseStrategy yields for the embedder default', () => {
    expect(parseStrategy('openai-small-3:body-only:v1')).toBe(STRATEGY_BODY_ONLY);
  });
});

describe('confidenceFromDistance', () => {
  const t = DISTANCE_THRESHOLD_BODY_ONLY;

  it('returns 1 at distance 0', () => {
    expect(confidenceFromDistance(0, t)).toBe(1);
  });

  it('returns 0 at distance == threshold', () => {
    expect(confidenceFromDistance(t, t)).toBe(0);
  });

  it('returns 0.5 at half the threshold', () => {
    expect(confidenceFromDistance(t / 2, t)).toBeCloseTo(0.5, 10);
  });

  it('clamps below 0 when distance exceeds threshold', () => {
    expect(confidenceFromDistance(t * 2, t)).toBe(0);
  });

  it('returns 0 for zero or negative threshold', () => {
    expect(confidenceFromDistance(0.1, 0)).toBe(0);
    expect(confidenceFromDistance(0.1, -1)).toBe(0);
  });
});

describe('vectorLiteral', () => {
  it('renders pgvector text format', () => {
    expect(vectorLiteral([0.1, -0.2, 0.3])).toBe('[0.1,-0.2,0.3]');
  });

  it('handles empty arrays', () => {
    expect(vectorLiteral([])).toBe('[]');
  });
});
