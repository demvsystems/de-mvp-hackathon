import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { edges, records } from '../schema';
import type { GetRecordsInput } from './schemas';
import type { RecordRow } from './types';

const recordColumns = {
  id: records.id,
  type: records.type,
  source: records.source,
  title: records.title,
  body: records.body,
  payload: records.payload,
  createdAt: records.createdAt,
  updatedAt: records.updatedAt,
  ingestedAt: records.ingestedAt,
  isDeleted: records.isDeleted,
} as const;

interface RecordWithConfidence extends RecordRow {
  edge_confidence: number | null;
}

export async function getRecords(input: GetRecordsInput): Promise<RecordWithConfidence[]> {
  const conditions: SQL[] = [eq(records.isDeleted, false)];

  if (input.ids && input.ids.length > 0) conditions.push(inArray(records.id, input.ids));
  if (input.exclude_ids && input.exclude_ids.length > 0) {
    conditions.push(notInArray(records.id, input.exclude_ids));
  }
  if (input.source && input.source.length > 0)
    conditions.push(inArray(records.source, input.source));
  if (input.type && input.type.length > 0) conditions.push(inArray(records.type, input.type));
  if (input.time_range?.after) {
    conditions.push(gte(records.createdAt, new Date(input.time_range.after)));
  }
  if (input.time_range?.before) {
    conditions.push(lte(records.createdAt, new Date(input.time_range.before)));
  }

  const subquerySources: SQL[] = [];
  if (input.topic_id) {
    subquerySources.push(sql`
      EXISTS (SELECT 1 FROM ${edges} e
              WHERE e.from_id = ${records.id}
                AND e.to_id = ${input.topic_id}
                AND e.type = 'discusses'
                AND e.valid_to IS NULL)
    `);
  }
  if (input.author_id) {
    subquerySources.push(sql`
      EXISTS (SELECT 1 FROM ${edges} e
              WHERE e.from_id = ${records.id}
                AND e.to_id = ${input.author_id}
                AND e.type = 'authored_by'
                AND e.valid_to IS NULL)
    `);
  }
  if (input.posted_in && input.posted_in.length > 0) {
    subquerySources.push(sql`
      EXISTS (SELECT 1 FROM ${edges} e
              WHERE e.from_id = ${records.id}
                AND e.to_id = ANY(ARRAY[${input.posted_in}]::text[])
                AND e.type = 'posted_in'
                AND e.valid_to IS NULL)
    `);
  }
  conditions.push(...subquerySources);

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  if (input.sort_by === 'edge_confidence' && input.topic_id) {
    return await edgeConfidenceSortedQuery(input, where);
  }

  const sortColumn = input.sort_by === 'updated_at' ? records.updatedAt : records.createdAt;
  const orderClause = input.order === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select(recordColumns)
    .from(records)
    .where(where)
    .orderBy(orderClause)
    .limit(input.limit);

  return rows.map((r) => ({ ...r, edge_confidence: null }));
}

async function edgeConfidenceSortedQuery(
  input: GetRecordsInput,
  where: SQL | undefined,
): Promise<RecordWithConfidence[]> {
  if (!input.topic_id) return [];

  const orderDir = input.order === 'asc' ? sql`ASC` : sql`DESC`;
  const rows = await db
    .select({
      record: recordColumns,
      edge_confidence: edges.confidence,
    })
    .from(records)
    .innerJoin(
      edges,
      and(
        eq(edges.fromId, records.id),
        eq(edges.toId, input.topic_id),
        eq(edges.type, 'discusses'),
        sql`${edges.validTo} IS NULL`,
      ),
    )
    .where(where)
    .orderBy(sql`${edges.confidence} ${orderDir}`)
    .limit(input.limit);

  return rows.map((r) => ({ ...r.record, edge_confidence: r.edge_confidence }));
}
