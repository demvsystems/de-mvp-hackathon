import { desc, inArray } from 'drizzle-orm';
import { db } from '../client';
import { topicAssessments, topics } from '../schema';
import type { GetTopicsInput } from './schemas';
import type { RecentAssessment, TopicWithAssessments } from './types';

export async function getTopics(input: GetTopicsInput): Promise<TopicWithAssessments[]> {
  const rows = await db.select().from(topics).where(inArray(topics.id, input.ids));
  if (rows.length === 0) return [];

  const topicIds = rows.map((r) => r.id);
  const assessments = await db
    .select({
      topicId: topicAssessments.topicId,
      assessor: topicAssessments.assessor,
      assessedAt: topicAssessments.assessedAt,
      character: topicAssessments.character,
      escalationScore: topicAssessments.escalationScore,
      reasoning: topicAssessments.reasoning,
      triggeredBy: topicAssessments.triggeredBy,
    })
    .from(topicAssessments)
    .where(inArray(topicAssessments.topicId, topicIds))
    .orderBy(desc(topicAssessments.assessedAt));

  const grouped = new Map<string, RecentAssessment[]>();
  for (const a of assessments) {
    const list = grouped.get(a.topicId) ?? [];
    if (list.length < input.recent_assessments_limit) {
      list.push({
        assessor: a.assessor,
        assessedAt: a.assessedAt,
        character: a.character,
        escalationScore: a.escalationScore,
        reasoning: a.reasoning,
        triggeredBy: a.triggeredBy,
      });
      grouped.set(a.topicId, list);
    }
  }

  return rows.map((topic) => ({
    topic,
    recent_assessments: grouped.get(topic.id) ?? [],
  }));
}
