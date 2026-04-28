import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';

export const CriterionKind = z.enum(['code', 'llm']);
export type CriterionKind = z.infer<typeof CriterionKind>;

export const CriterionConfig = z.object({
  id: z.string(),
  weight: z.number().min(0),
  kind: CriterionKind,
  description: z.string().optional(),
  threshold: z.number().optional(),
  judge_model: z.string().optional(),
  applies_to_categories: z.array(z.string()).optional(),
});
export type CriterionConfig = z.infer<typeof CriterionConfig>;

export const RubricConfig = z.object({
  version: z.string(),
  pass_threshold: z.number().min(0).max(1),
  criteria: z.array(CriterionConfig).min(1),
});
export type RubricConfig = z.infer<typeof RubricConfig>;

const RubricFile = z.object({ rubric: RubricConfig });

export async function loadRubric(path: string): Promise<RubricConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = parse(raw);
  return RubricFile.parse(parsed).rubric;
}
