import { z } from 'zod';

export const EdgeTypeEnum = z.enum([
  'authored_by',
  'replies_to',
  'commented_on',
  'posted_in',
  'child_of',
  'references',
  'assigned_to',
  'belongs_to_sprint',
  'mentions',
  'discusses',
  'supersedes',
]);

export const RecordSortBy = z.enum(['created_at', 'updated_at', 'edge_confidence']);
export const SortOrder = z.enum(['asc', 'desc']);

export const GetTopicsInput = z.object({
  ids: z.array(z.string()).min(1).max(20),
  recent_assessments_limit: z.number().int().min(0).max(20).default(5),
});
export type GetTopicsInput = z.infer<typeof GetTopicsInput>;

export const GetRecordsInput = z.object({
  ids: z.array(z.string()).optional(),
  exclude_ids: z.array(z.string()).optional(),
  topic_id: z.string().optional(),
  source: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  author_id: z.string().optional(),
  posted_in: z.array(z.string()).optional(),
  time_range: z
    .object({
      after: z.iso.datetime().optional(),
      before: z.iso.datetime().optional(),
    })
    .optional(),
  sort_by: RecordSortBy.default('created_at'),
  order: SortOrder.default('desc'),
  limit: z.number().int().min(1).max(100).default(20),
});
export type GetRecordsInput = z.infer<typeof GetRecordsInput>;

export const GetNeighborsInput = z.object({
  from_ids: z.array(z.string()).min(1).max(20),
  edge_types: z.array(EdgeTypeEnum).optional(),
  depth: z.number().int().min(1).max(5).default(1),
  limit: z.number().int().min(1).max(200).default(50),
  sort_by: z.enum(['created_at', 'updated_at', 'confidence']).default('created_at'),
  order: SortOrder.default('desc'),
});
export type GetNeighborsInput = z.infer<typeof GetNeighborsInput>;

export const FindSimilarInput = z.object({
  anchor_ids: z.array(z.string()).min(1).max(10),
  limit: z.number().int().min(1).max(50).default(10),
  model_version: z.string().optional(),
});
export type FindSimilarInput = z.infer<typeof FindSimilarInput>;
