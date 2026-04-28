import { sql } from '@repo/db';
import { publish } from '@repo/messaging';
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
             centroid_body_only <=> ${vectorLit}::vector AS distance,
             centroid_body_only AS centroid,
             member_count_body_only AS member_count
        FROM topics
       WHERE status = 'active'
         AND centroid_body_only IS NOT NULL
       ORDER BY centroid_body_only <=> ${vectorLit}::vector
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

  publish,
};
