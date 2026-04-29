import { sql } from '@repo/db';

type ActivityTrend = 'growing' | 'stable' | 'declining' | 'dormant';
type StagnationSeverity = 'none' | 'low' | 'medium' | 'high';

interface AggregatedMetrics {
  member_count: number;
  source_count: number;
  unique_authors_7d: number;
  first_activity_at: Date | null;
  last_activity_at: Date | null;
  velocity_24h: number;
  velocity_7d_avg: number;
  spread_24h: number;
  activity_trend: ActivityTrend;
}

// Recompute the topic's activity columns from the canonical `discusses` edges
// joined with their source records. Triggered after each clustering decision so
// `triage_topics`/LLM-Bewerter see live signals; safe to call repeatedly.
//
// Stagnation is intentionally simplified to match scripts/preseed-expected-topics.ts:
// dormant trend → severity 'low', otherwise 'none'. Phase-2 replaces this with the
// full Zettel-9 logic that walks replies_to/commented_on follow-up edges.
export async function recomputeTopicActivity(topicId: string): Promise<void> {
  await sql.begin(async (tx) => {
    // Row lock serializes concurrent recomputes against the same topic. No-op
    // when the topic row doesn't exist yet — the UPDATE below is idempotent too.
    await tx`SELECT 1 FROM topics WHERE id = ${topicId} FOR UPDATE`;

    const rows = await tx<AggregatedMetrics[]>`
      WITH topic_members AS (
        SELECT r.id, r.source, r.created_at, r.payload
          FROM edges e
          JOIN records r ON r.id = e.from_id AND r.is_deleted = false
         WHERE e.to_id = ${topicId}
           AND e.type = 'discusses'
           AND e.valid_to IS NULL
      )
      SELECT
        COUNT(*)::int                                                       AS member_count,
        COUNT(DISTINCT source)::int                                         AS source_count,
        MIN(created_at)                                                     AS first_activity_at,
        MAX(created_at)                                                     AS last_activity_at,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int
                                                                            AS velocity_24h,
        ROUND(
          (COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::numeric / 7.0),
          1
        )::real                                                             AS velocity_7d_avg,
        COUNT(DISTINCT source) FILTER (WHERE created_at >= now() - interval '24 hours')::int
                                                                            AS spread_24h,
        COUNT(DISTINCT COALESCE(
          payload->>'author_id',
          payload->>'reporter',
          payload->>'assignee',
          payload->'author'->>'id',
          'fallback:' || source
        )) FILTER (WHERE created_at >= now() - interval '7 days')::int
                                                                            AS unique_authors_7d,
        CASE
          WHEN COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')
               > COUNT(*)::numeric / 2.0
            THEN 'growing'
          WHEN COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') > 0
            THEN 'stable'
          WHEN COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') > 0
            THEN 'declining'
          ELSE 'dormant'
        END                                                                 AS activity_trend
      FROM topic_members
    `;

    const m = rows[0];
    if (!m) return;

    const stagnationSeverity: StagnationSeverity =
      m.activity_trend === 'dormant' && m.member_count > 0 ? 'low' : 'none';
    const stagnationSignalCount = stagnationSeverity === 'none' ? 0 : 1;

    await tx`
      UPDATE topics
         SET member_count            = ${m.member_count},
             source_count            = ${m.source_count},
             unique_authors_7d       = ${m.unique_authors_7d},
             first_activity_at       = ${m.first_activity_at},
             last_activity_at        = ${m.last_activity_at},
             velocity_24h            = ${m.velocity_24h},
             velocity_7d_avg         = ${m.velocity_7d_avg},
             spread_24h              = ${m.spread_24h},
             activity_trend          = ${m.activity_trend},
             stagnation_signal_count = ${stagnationSignalCount},
             stagnation_severity     = ${stagnationSeverity},
             computed_at             = now()
       WHERE id = ${topicId}
    `;
  });
}
