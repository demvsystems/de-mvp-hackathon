import { read, sql } from '@repo/db';
import type { RecordPayload } from '@repo/messaging';

type RecordRowNonNull = NonNullable<read.NeighborRecord['record']>;

export interface NeighborBlock {
  relation: 'thread_parent' | 'references' | 'recent_comment';
  title: string | null;
  body: string | null;
}

export interface StructuralNeighbors {
  threadParent: NeighborBlock | null;
  references: NeighborBlock[];
  recentComments: NeighborBlock[];
}

const REFERENCES_LIMIT = 3;
const COMMENTS_LIMIT = 3;

export async function loadStructuralNeighbors(recordId: string): Promise<StructuralNeighbors> {
  const [outgoing, recentComments] = await Promise.all([
    read.getNeighbors({
      from_ids: [recordId],
      edge_types: ['replies_to', 'references'],
      depth: 1,
      limit: REFERENCES_LIMIT + 1,
      sort_by: 'created_at',
      order: 'desc',
    }),
    loadIncomingComments(recordId, COMMENTS_LIMIT),
  ]);

  let threadParent: NeighborBlock | null = null;
  const references: NeighborBlock[] = [];
  for (const n of outgoing) {
    if (!n.record) continue;
    if (n.edge.type === 'replies_to' && !threadParent) {
      threadParent = blockFromRecord('thread_parent', n.record);
    } else if (n.edge.type === 'references' && references.length < REFERENCES_LIMIT) {
      references.push(blockFromRecord('references', n.record));
    }
  }

  return { threadParent, references, recentComments };
}

type CommentRow = { title: string | null; body: string | null };

async function loadIncomingComments(recordId: string, limit: number): Promise<NeighborBlock[]> {
  const rows = await sql<CommentRow[]>`
    SELECT r.title, r.body
    FROM edges e
    JOIN records r ON r.id = e.from_id AND r.is_deleted = false
    WHERE e.to_id = ${recordId}
      AND e.type = 'commented_on'
      AND e.valid_to IS NULL
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ relation: 'recent_comment', title: r.title, body: r.body }));
}

function blockFromRecord(
  relation: NeighborBlock['relation'],
  record: RecordRowNonNull,
): NeighborBlock {
  return { relation, title: record.title, body: record.body };
}

export function recordRowToPayload(row: RecordRowNonNull): RecordPayload {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    title: row.title,
    body: row.body,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function fetchRecord(id: string): Promise<RecordRowNonNull | null> {
  const rows = await read.getRecords({
    ids: [id],
    limit: 1,
    sort_by: 'created_at',
    order: 'desc',
  });
  const row = rows[0];
  if (!row) return null;
  const { edge_confidence: _ignored, ...rest } = row;
  return rest as RecordRowNonNull;
}
