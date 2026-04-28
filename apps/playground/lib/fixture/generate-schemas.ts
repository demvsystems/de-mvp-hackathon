import { z } from 'zod';
import path from 'node:path';
import { FIXTURE_SOURCES } from './sources';

export const GenerateSourceSchema = z.enum(FIXTURE_SOURCES);
export const fixtureSourceSchema = GenerateSourceSchema;

export const DetailLevelSchema = z.enum(['low', 'medium', 'high']);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const SentimentSchema = z.enum(['neutral', 'frustrated', 'positive', 'negative']);

export const GeneratePreviewRequestSchema = z.object({
  source: GenerateSourceSchema,
  topic: z.string().trim().min(1).max(240),
  product: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  language: z.string().trim().min(2).max(24),
  count: z.number().int().min(1).max(100),
  detailLevel: DetailLevelSchema.optional(),
  severity: SeveritySchema.optional(),
  sentiment: SentimentSchema.optional(),
});

export type GeneratePreviewRequest = z.infer<typeof GeneratePreviewRequestSchema>;

export const PreviewItemSchema = z.object({
  filename: z.string().min(1).endsWith('.json'),
  content: z.record(z.string(), z.unknown()),
});

export type PreviewItem = z.infer<typeof PreviewItemSchema>;

export const validationIssueSchema = z.object({
  severity: z.enum(['warning', 'error']),
  path: z.string(),
  message: z.string(),
});

export const validationResultItemSchema = z.object({
  filename: z.string(),
  status: z.enum(['ok', 'warning', 'error']),
  issues: z.array(validationIssueSchema),
});

export const GeneratePreviewResponseSchema = z.object({
  items: z.array(PreviewItemSchema),
  warnings: z.array(z.string()),
  generationMode: z.enum(['ai', 'fallback']),
  validation: z.array(validationResultItemSchema),
});

export type GeneratePreviewResponse = z.infer<typeof GeneratePreviewResponseSchema>;

export const safeFixtureFilenameSchema = z
  .string()
  .min(1)
  .refine((value) => value.endsWith('.json'), {
    message: 'filename must end with .json',
  })
  .refine((value) => !value.endsWith('.jsonl'), {
    message: 'filename must not end with .jsonl',
  })
  .refine((value) => !value.includes('/'), {
    message: 'filename must not contain "/"',
  })
  .refine((value) => !value.includes('\\'), {
    message: 'filename must not contain "\\\\"',
  })
  .refine((value) => !value.includes('..'), {
    message: 'filename must not contain ".."',
  })
  .refine((value) => !path.isAbsolute(value), {
    message: 'filename must not be an absolute path',
  });

export const saveFixtureItemSchema = z.object({
  filename: safeFixtureFilenameSchema,
  content: z.record(z.string(), z.unknown()),
});

export const saveFixtureRequestSchema = z.object({
  source: fixtureSourceSchema,
  items: z.array(saveFixtureItemSchema).min(1),
  overwrite: z.boolean().optional().default(false),
});

export type SaveFixtureRequest = z.infer<typeof saveFixtureRequestSchema>;
export type SaveFixtureItem = z.infer<typeof saveFixtureItemSchema>;

export const saveFixtureResponseSchema = z.object({
  saved: z.array(
    z.object({
      filename: z.string(),
      path: z.string(),
    }),
  ),
  warnings: z.array(
    z.object({
      filename: z.string(),
      message: z.string(),
    }),
  ),
});

export type SaveFixtureResponse = z.infer<typeof saveFixtureResponseSchema>;

const booleanStringSchema = z
  .union([z.literal('true'), z.literal('false')])
  .transform((value) => value === 'true');

export const listSavedFixturesQuerySchema = z.object({
  source: fixtureSourceSchema.optional(),
  includeContent: booleanStringSchema.optional().default(false),
  includeValidation: booleanStringSchema.optional().default(true),
});

export type ListSavedFixturesQuery = z.infer<typeof listSavedFixturesQuerySchema>;

export const readSavedFixtureQuerySchema = z.object({
  source: fixtureSourceSchema,
  filename: safeFixtureFilenameSchema,
});

export type ReadSavedFixtureQuery = z.infer<typeof readSavedFixtureQuerySchema>;

export const deleteSavedFixtureRequestSchema = z.object({
  source: fixtureSourceSchema,
  filename: safeFixtureFilenameSchema,
});

export type DeleteSavedFixtureRequest = z.infer<typeof deleteSavedFixtureRequestSchema>;

export const manifestQuerySchema = z.object({
  source: fixtureSourceSchema.optional(),
  includeValidation: booleanStringSchema.optional().default(true),
  write: booleanStringSchema.optional().default(false),
});

export type ManifestQuery = z.infer<typeof manifestQuerySchema>;
