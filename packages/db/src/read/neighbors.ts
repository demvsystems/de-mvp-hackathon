import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { GetNeighborsInput } from './schemas';
import type { NeighborRecord, RecordRow } from './types';

type NeighborRow = {
  fromId: string;
  toId: string;
  type: string;
  source: string;
  confidence: number;
  evidence: unknown;
  recordId: string | null;
  recordType: string | null;
  recordSource: string | null;
  recordTitle: string | null;
  recordBody: string | null;
  recordPayload: unknown;
  recordCreatedAt: Date | null;
  recordUpdatedAt: Date | null;
  recordIngestedAt: Date | null;
  recordIsDeleted: boolean | null;
} & Record<string, unknown>;

export async function getNeighbors(input: GetNeighborsInput): Promise<NeighborRecord[]> {
  const edgeTypeFilter =
    input.edge_types && input.edge_types.length > 0
      ? sql`AND e.type = ANY(ARRAY[${input.edge_types}]::text[])`
      : sql``;

  const sortField =
    input.sort_by === 'confidence'
      ? sql`"confidence"`
      : input.sort_by === 'updated_at'
        ? sql`"recordUpdatedAt"`
        : sql`"recordCreatedAt"`;
  const orderDir = input.order === 'asc' ? sql`ASC` : sql`DESC`;

  // path[] accumulates visited node ids; we refuse to re-walk into one we've
  // already passed through. Without this guard a cycle in the edge graph fans
  // the recursive CTE out exponentially before the final LIMIT applies.
  const rows = await db.execute<NeighborRow>(sql`
    WITH RECURSIVE walk AS (
      SELECT e.from_id, e.to_id, e.type, e.source, e.confidence, e.evidence,
             1 AS depth,
             ARRAY[e.from_id, e.to_id] AS path
      FROM edges e
      WHERE e.from_id = ANY(ARRAY[${input.from_ids}]::text[])
        AND e.valid_to IS NULL
        ${edgeTypeFilter}

      UNION ALL

      SELECT e.from_id, e.to_id, e.type, e.source, e.confidence, e.evidence,
             walk.depth + 1,
             walk.path || e.to_id
      FROM edges e
      JOIN walk ON e.from_id = walk.to_id
      WHERE walk.depth < ${input.depth}
        AND e.valid_to IS NULL
        AND NOT (e.to_id = ANY(walk.path))
        ${edgeTypeFilter}
    )
    SELECT * FROM (
      SELECT DISTINCT ON (walk.from_id, walk.to_id, walk.type)
             walk.from_id     AS "fromId",
             walk.to_id       AS "toId",
             walk.type        AS "type",
             walk.source      AS "source",
             walk.confidence  AS "confidence",
             walk.evidence    AS "evidence",
             r.id             AS "recordId",
             r.type           AS "recordType",
             r.source         AS "recordSource",
             r.title          AS "recordTitle",
             r.body           AS "recordBody",
             r.payload        AS "recordPayload",
             r.created_at     AS "recordCreatedAt",
             r.updated_at     AS "recordUpdatedAt",
             r.ingested_at    AS "recordIngestedAt",
             r.is_deleted     AS "recordIsDeleted"
      FROM walk
      LEFT JOIN records r ON r.id = walk.to_id AND r.is_deleted = false
      ORDER BY walk.from_id, walk.to_id, walk.type
    ) deduped
    ORDER BY ${sortField} ${orderDir} NULLS LAST
    LIMIT ${input.limit}
  `);

  return rows.map((r) => ({
    edge: {
      fromId: r.fromId,
      toId: r.toId,
      type: r.type,
      source: r.source,
      confidence: r.confidence,
      evidence: r.evidence,
    },
    record: r.recordId
      ? ({
          id: r.recordId,
          type: r.recordType,
          source: r.recordSource,
          title: r.recordTitle,
          body: r.recordBody,
          payload: r.recordPayload as Record<string, unknown>,
          createdAt: r.recordCreatedAt,
          updatedAt: r.recordUpdatedAt,
          ingestedAt: r.recordIngestedAt,
          isDeleted: r.recordIsDeleted,
        } as RecordRow)
      : null,
  }));
}
