import type { GeneratePreviewRequest } from './generate-schemas';
import type { FixtureSource } from './sources';

const SAFE_DOMAINS = ['example.com', 'example.org', 'example.net', 'example.test'];

export interface GeneratorContext {
  source: FixtureSource;
  topic: string;
  product: string;
  category: string;
  language: string;
  detailLevel: string;
  severity: string;
  sentiment: string;
  count: number;
}

export type RandomFn = () => number;

export function toGeneratorContext(input: GeneratePreviewRequest): GeneratorContext {
  return {
    source: input.source,
    topic: input.topic,
    product: input.product,
    category: input.category,
    language: input.language,
    detailLevel: input.detailLevel ?? 'medium',
    severity: input.severity ?? 'medium',
    sentiment: input.sentiment ?? 'neutral',
    count: input.count,
  };
}

export function stableSeedFromInput(ctx: GeneratorContext): string {
  return [
    ctx.source,
    ctx.topic,
    ctx.product,
    ctx.category,
    ctx.language,
    String(ctx.count),
    ctx.detailLevel,
    ctx.severity,
    ctx.sentiment,
  ].join('|');
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seedText: string): RandomFn {
  let seed = fnv1a32(seedText);
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(rng: RandomFn, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[index]!;
}

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'topic';
}

export function formatFilename(args: {
  date: Date;
  source: FixtureSource;
  category: string;
  topic: string;
  index: number;
}): string {
  const datePart = args.date.toISOString().slice(0, 10);
  const categorySlug = slugify(args.category);
  const topicSlug = slugify(args.topic);
  const idx = String(args.index + 1).padStart(3, '0');
  const raw = `${datePart}_${args.source}_${categorySlug}_${topicSlug}_${idx}.json`;
  const safe = raw.replace(/[\\/]/g, '_');
  if (!safe.endsWith('.json')) return `${safe}.json`;
  return safe;
}

export function ensureSafeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed.endsWith('.json')) {
    throw new Error('Generated filename must end with .json');
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Generated filename contains unsafe path characters');
  }
  return trimmed;
}

export function dummyEmail(token: string): string {
  return `dummy.${token}@example.com`;
}

export function dummyUrl(token: string): string {
  return `https://dummy-${token}.example.test`;
}

export function isAllowedDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  if (SAFE_DOMAINS.includes(normalized)) return true;
  return SAFE_DOMAINS.some((allowed) => normalized.endsWith(`.${allowed}`));
}

export function replaceUnsafeDomainsInString(input: string): string {
  return input.replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi, (domain) =>
    isAllowedDomain(domain) ? domain : 'dummy.example.test',
  );
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
