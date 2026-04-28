import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const FixtureRecord = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type FixtureRecord = z.infer<typeof FixtureRecord>;

const FixtureEdge = z.object({
  from_id: z.string(),
  to_id: z.string(),
  type: z.string(),
  source: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  weight: z.number().default(1),
  valid_from: z.iso.datetime(),
  valid_to: z.iso.datetime().nullable().default(null),
  observed_at: z.iso.datetime(),
});
export type FixtureEdge = z.infer<typeof FixtureEdge>;

const FixtureTopic = z.object({
  id: z.string(),
  status: z.literal('active'),
  label: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  discovered_at: z.iso.datetime(),
  discovered_by: z.string(),
  member_count: z.number().int().nonnegative().default(0),
  source_count: z.number().int().nonnegative().default(0),
  unique_authors_7d: z.number().int().nonnegative().default(0),
  first_activity_at: z.iso.datetime().nullable().default(null),
  last_activity_at: z.iso.datetime().nullable().default(null),
  velocity_24h: z.number().int().nullable().default(null),
  velocity_7d_avg: z.number().nullable().default(null),
  spread_24h: z.number().int().nullable().default(null),
  activity_trend: z.string().nullable().default(null),
  computed_at: z.iso.datetime().nullable().default(null),
  stagnation_signal_count: z.number().int().nonnegative().default(0),
  stagnation_severity: z.string().default('none'),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type FixtureTopic = z.infer<typeof FixtureTopic>;

export const ExpectedToolCalls = z.object({
  required: z.array(z.string()).default([]),
  forbidden: z.array(z.string()).default([]),
});
export type ExpectedToolCalls = z.infer<typeof ExpectedToolCalls>;

export const Expected = z.object({
  character: z.enum(['attention', 'opportunity', 'noteworthy', 'calm']),
  escalation_score: z.number().min(0).max(1),
  anchor_record_ids: z.array(z.string()).default([]),
  expected_signals: z.array(z.string()).default([]),
  tool_calls: ExpectedToolCalls.default({ required: [], forbidden: [] }),
});
export type Expected = z.infer<typeof Expected>;

export const Fixture = z.object({
  id: z.string(),
  category: z.enum(['happy', 'edge', 'adversarial']),
  notes: z.string().optional(),
  topic: FixtureTopic,
  records: z.array(FixtureRecord),
  edges: z.array(FixtureEdge),
  expected: Expected,
});
export type Fixture = z.infer<typeof Fixture>;

export async function loadFixtures(dir: string): Promise<Fixture[]> {
  const files = await readdir(dir);
  const jsonl = files.filter((f) => f.endsWith('.jsonl')).sort();
  const out: Fixture[] = [];
  for (const file of jsonl) {
    const raw = await readFile(join(dir, file), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const [idx, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${idx + 1} — JSON parse failed: ${String(err)}`);
      }
      const result = Fixture.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `${file}:${idx + 1} — fixture schema invalid: ${JSON.stringify(result.error.issues)}`,
        );
      }
      out.push(result.data);
    }
  }
  return out;
}
