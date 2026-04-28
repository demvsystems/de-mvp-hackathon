import type { edges, records, topicAssessments, topics } from '../schema';

// Omit searchVector: it's a generated tsvector column for the GIN index and
// shouldn't be materialized into read results (cost) or exposed to callers.
export type RecordRow = Omit<typeof records.$inferSelect, 'searchVector'>;
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
