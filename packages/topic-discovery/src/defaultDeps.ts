import { sql } from '@repo/db';
import { publishWithPersist } from '@repo/materializer';
import { TOPIC_DISCOVERY_SOURCE } from './cluster';
import type { DiscoveryDeps } from './discover';

function parsePgVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((n) => Number(n));
  if (typeof raw === 'string') {
    return raw
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => Number(s.trim()));
  }
  throw new Error(`unexpected pgvector value: ${typeof raw}`);
}

export const defaultDeps: DiscoveryDeps = {
  async findNearestActiveTopic(vectorLit) {
    const rows = await sql<
      { id: string; distance: number; centroid: unknown; member_count: number }[]
    >`
      SELECT id,
             centroid <=> ${vectorLit}::vector AS distance,
             centroid,
             member_count
        FROM topics
       WHERE status = 'active'
         AND centroid IS NOT NULL
       ORDER BY centroid <=> ${vectorLit}::vector
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      distance: Number(row.distance),
      centroid: parsePgVector(row.centroid),
      memberCount: Number(row.member_count),
    };
  },

  async isAlreadyMember(recordId, topicId) {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT 1 AS exists
        FROM edges
       WHERE from_id = ${recordId}
         AND to_id   = ${topicId}
         AND type    = 'discusses'
         AND source  = ${TOPIC_DISCOVERY_SOURCE}
         AND valid_to IS NULL
       LIMIT 1
    `;
    return rows.length > 0;
  },

  publishWithPersist,
};
