// NOTE: constant names still say "BODY_ONLY" but values now point at the
// with-neighbors strategy — kept the names to minimise diff churn; rename in a
// follow-up. The active clustering pipeline is with-neighbors only.
export const STRATEGY_BODY_ONLY = 'with-neighbors';

// Cosine-distance threshold below which an embedding joins the nearest topic.
// Calibrated against the 15-record gold set in eval/clustering — peak ARI 0.73
// at 0.40 for the with-neighbors strategy (body-only never exceeded ARI 0.17).
export const DISTANCE_THRESHOLD_BODY_ONLY = 0.4;

export const TOPIC_DISCOVERY_SOURCE_BODY_ONLY = 'topic-discovery:with-neighbors:v1';

// model_version layout: `${modelTag}:${strategy}:${version}` (see embedder/embed.ts)
export function parseStrategy(modelVersion: string): string {
  return modelVersion.split(':')[1] ?? '';
}

export function confidenceFromDistance(distance: number, threshold: number): number {
  if (threshold <= 0) return 0;
  const raw = 1 - distance / threshold;
  return Math.max(0, Math.min(1, raw));
}

export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}
