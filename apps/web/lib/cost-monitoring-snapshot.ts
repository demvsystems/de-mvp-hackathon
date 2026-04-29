export interface CostBar {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly hint?: string;
}

export const costMonitoringSnapshot = {
  snapshotDate: '2026-04-29',
  cutoffIso: '2026-04-29T10:20:00Z',
  projectName: 'de-mvp-hackathon',
  headline: {
    traces: 197,
    totalTracedCost: 21.80836154985001,
    avgTraceCost: 0.11070234289263964,
    generations: 787,
    cacheReadCount: 771,
    cacheReadRate: 0.9796696315120712,
    estimatedNoCacheCost: 28.85500499984996,
    estimatedNetSavings: 7.046643450000001,
    estimatedSavingsRate: 0.24420870660173657,
  },
  featureSplit: [
    {
      label: 'topic-review',
      traces: 179,
      totalCost: 21.049265699856004,
      avgCost: 0.11759366312768718,
      share: 0.9651924401446277,
      color: 'bg-neutral-950',
    },
    {
      label: 'uncategorized',
      traces: 18,
      totalCost: 0.759095849994,
      avgCost: 0.042171991666333335,
      share: 0.03480755985537236,
      color: 'bg-neutral-300',
    },
  ] as const,
  triggerSplit: [
    {
      label: 'topic.created',
      traces: 114,
      totalCost: 14.557891199902,
      avgCost: 0.12770079999914036,
    },
    {
      label: 'topic.updated',
      traces: 63,
      totalCost: 6.399932699955,
      avgCost: 0.10158623333261906,
    },
    {
      label: 'eval',
      traces: 2,
      totalCost: 0.091441799999,
      avgCost: 0.0457208999995,
    },
  ] as const,
  costComposition: [
    {
      label: 'Input',
      value: 14.308025999999993,
      color: 'bg-neutral-950',
      hint: 'base prompt + context',
    },
    {
      label: 'Output',
      value: 4.204560000000003,
      color: 'bg-amber-500',
      hint: 'model completion',
    },
    {
      label: 'Cache write',
      value: 2.458188749999997,
      color: 'bg-lime-500',
      hint: 'cache creation premium',
    },
    {
      label: 'Cache read',
      value: 0.8375868000000025,
      color: 'bg-emerald-500',
      hint: 'discounted cached input',
    },
  ] as const satisfies readonly CostBar[],
  tokenComposition: [
    {
      label: 'Input',
      value: 4_769_342,
      color: 'bg-neutral-950',
    },
    {
      label: 'Output',
      value: 280_304,
      color: 'bg-amber-500',
    },
    {
      label: 'Cache write',
      value: 655_517,
      color: 'bg-lime-500',
    },
    {
      label: 'Cache read',
      value: 2_791_956,
      color: 'bg-emerald-500',
    },
  ] as const satisfies readonly CostBar[],
  notes: {
    safeClaims: [
      'Per-call LLM cost is tracked in Langfuse.',
      'Prompt caching is active on real traffic, not just configured.',
      'The current snapshot implies about 24% lower cost than an uncached equivalent workload.',
      'Most observed spend is concentrated in one tagged feature: topic-review.',
    ],
    excludedClaims: [
      'No cohort split is shown yet.',
      'No multi-model routing benchmark is shown yet.',
      'This does not prove Gold cost monitoring end-to-end.',
    ],
  },
} as const;

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 3,
  }).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
