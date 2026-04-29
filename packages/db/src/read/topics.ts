import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { topics } from '../schema';
import type { GetTopicsInput } from './schemas';
import { pgTextArray } from './sql-helpers';
import type { RecentAssessment, TopicRow, TopicWithAssessments } from './types';

export interface ListActiveTopicsInput {
  limit?: number;
  recent_assessments_limit?: number;
}

type RankedAssessment = {
  topicId: string;
  assessor: string;
  assessedAt: Date | string;
  character: string;
  escalationScore: number;
  reasoning: unknown;
  triggeredBy: string | null;
  traceId: string | null;
};

export async function getTopics(input: GetTopicsInput): Promise<TopicWithAssessments[]> {
  // Run topics + ranked assessments in parallel: both queries key off input.ids
  // and don't depend on each other. The window function keeps only the N most
  // recent assessments per topic in SQL, instead of fetching the full history.
  const [rows, rankedRows] = await Promise.all([
    db.select().from(topics).where(inArray(topics.id, input.ids)),
    input.recent_assessments_limit > 0
      ? db.execute<RankedAssessment>(sql`
          SELECT topic_id        AS "topicId",
                 assessor        AS "assessor",
                 assessed_at     AS "assessedAt",
                 character       AS "character",
                 escalation_score AS "escalationScore",
                 reasoning       AS "reasoning",
                 triggered_by    AS "triggeredBy",
                 trace_id        AS "traceId"
          FROM (
            SELECT a.*,
                   ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY assessed_at DESC) AS rn
            FROM topic_assessments a
            WHERE a.topic_id = ANY(${pgTextArray(input.ids)})
          ) ranked
          WHERE rn <= ${input.recent_assessments_limit}
        `)
      : Promise.resolve([] as RankedAssessment[]),
  ]);

  if (rows.length === 0) return [];

  const grouped = new Map<string, RecentAssessment[]>();
  for (const a of rankedRows) {
    const list = grouped.get(a.topicId) ?? [];
    list.push({
      assessor: a.assessor,
      // Raw db.execute via aliased column doesn't always trigger postgres-js
      // timestamp parsing, so coerce defensively to honor the Date contract.
      assessedAt: a.assessedAt instanceof Date ? a.assessedAt : new Date(a.assessedAt),
      character: a.character,
      escalationScore: a.escalationScore,
      reasoning: a.reasoning,
      triggeredBy: a.triggeredBy,
      traceId: a.traceId,
    });
    grouped.set(a.topicId, list);
  }

  return rows.map(
    (topic: TopicRow): TopicWithAssessments => ({
      topic,
      recent_assessments: grouped.get(topic.id) ?? [],
    }),
  );
}

export async function listActiveTopics(
  input: ListActiveTopicsInput = {},
): Promise<TopicWithAssessments[]> {
  const limit = input.limit ?? 100;
  const recentLimit = input.recent_assessments_limit ?? 5;

  const rows = await db
    .select()
    .from(topics)
    .where(eq(topics.status, 'active'))
    .orderBy(sql`${topics.lastActivityAt} DESC NULLS LAST, ${topics.discoveredAt} DESC`)
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r: TopicRow) => r.id);
  const rankedRows =
    recentLimit > 0
      ? await db.execute<RankedAssessment>(sql`
          SELECT topic_id        AS "topicId",
                 assessor        AS "assessor",
                 assessed_at     AS "assessedAt",
                 character       AS "character",
                 escalation_score AS "escalationScore",
                 reasoning       AS "reasoning",
                 triggered_by    AS "triggeredBy",
                 trace_id        AS "traceId"
          FROM (
            SELECT a.*,
                   ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY assessed_at DESC) AS rn
            FROM topic_assessments a
            WHERE a.topic_id = ANY(${pgTextArray(ids)})
          ) ranked
          WHERE rn <= ${recentLimit}
        `)
      : [];

  const grouped = new Map<string, RecentAssessment[]>();
  for (const a of rankedRows) {
    const list = grouped.get(a.topicId) ?? [];
    list.push({
      assessor: a.assessor,
      // Raw db.execute via aliased column doesn't always trigger postgres-js
      // timestamp parsing, so coerce defensively to honor the Date contract.
      assessedAt: a.assessedAt instanceof Date ? a.assessedAt : new Date(a.assessedAt),
      character: a.character,
      escalationScore: a.escalationScore,
      reasoning: a.reasoning,
      triggeredBy: a.triggeredBy,
      traceId: a.traceId,
    });
    grouped.set(a.topicId, list);
  }

  return rows.map(
    (topic: TopicRow): TopicWithAssessments => ({
      topic,
      recent_assessments: grouped.get(topic.id) ?? [],
    }),
  );
}
