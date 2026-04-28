import type { edges, records, topicAssessments, topics } from '../schema';

export type RecordRow = typeof records.$inferSelect;
export type EdgeRow = typeof edges.$inferSelect;
export type TopicRow = typeof topics.$inferSelect;
export type TopicAssessmentRow = typeof topicAssessments.$inferSelect;

export type RecentAssessment = Pick<
  TopicAssessmentRow,
  'assessor' | 'assessedAt' | 'character' | 'escalationScore' | 'reasoning' | 'triggeredBy'
>;

export interface TopicWithAssessments {
  topic: TopicRow;
  recent_assessments: RecentAssessment[];
}

export interface NeighborRecord {
  edge: Pick<EdgeRow, 'fromId' | 'toId' | 'type' | 'source' | 'confidence' | 'evidence'>;
  record: RecordRow | null;
}

export interface SimilarRecord {
  record: RecordRow;
  similarity: number;
}
