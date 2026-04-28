export const STRATEGY_BODY_ONLY = 'body-only';

// Cosine-distance threshold below which an embedding joins the nearest topic.
// Pilot default per Zettel 5; calibrate against synthetic gold standard.
export const DISTANCE_THRESHOLD_BODY_ONLY = 0.3;

export const TOPIC_DISCOVERY_SOURCE_BODY_ONLY = 'topic-discovery:body-only:v1';

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
