/**
 * Shapes mirror the documented Tool-Layer responses (docs/rough-design/06_tool_layer.md
 * and 03_materialisierer.md). Keep these aligned so the frontend can switch from
 * fixtures to live `/tools/*` calls without touching the UI.
 */

export type Source = 'slack' | 'jira' | 'github' | 'confluence' | 'intercom' | 'topic';

export type Character = 'attention' | 'opportunity' | 'noteworthy' | 'calm';

export type ActivityTrend = 'growing' | 'stable' | 'declining' | 'dormant';

export type StagnationSeverity = 'none' | 'low' | 'medium' | 'high';

export type MatchProvenance =
  | { type: 'lexical'; matched_terms: string[]; rank: number }
  | { type: 'semantic'; similarity: number; model_version: string }
  | { type: 'edge'; edge_type: string; edge_source: string; edge_confidence: number }
  | { type: 'topic_membership'; topic_id: string; topic_confidence: number }
  | { type: 'recency'; days_ago: number };

export type Scoring = {
  score: number;
  matched_via: MatchProvenance[];
};

export type AssessmentReasoning = {
  sentiment_aggregate: string;
  key_signals: string[];
  key_artifacts: string[];
  additional_notes?: string;
};

export type TriageTopic = {
  id: string;
  type: 'topic';
  title: string | null;
  snippet: string | null;
  source: 'topic';
  scoring: Scoring;
  metadata: {
    character: Character;
    reasoning: AssessmentReasoning;
    last_activity_at: string;
    member_count: number;
    source_count: number;
    stagnation_severity: StagnationSeverity;
  };
};

export type TopicMember = {
  id: string;
  type: string;
  source: Source;
  title: string | null;
  body_snippet: string;
  author_display_name: string | null;
  occurred_at: string;
  edge_confidence: number;
};

export type AssessmentHistoryEntry = {
  assessed_at: string;
  character: Character;
  escalation_score: number;
  brief_reasoning: string;
};

export type TopicContext = {
  id: string;
  label: string;
  status: 'active' | 'proposed' | 'archived' | 'superseded';
  discovered_at: string;
  discovered_by: string;
  activity: {
    member_count: number;
    source_count: number;
    unique_authors_7d: number;
    velocity_24h: number;
    velocity_7d_avg: number;
    trend: ActivityTrend;
    last_activity_at: string;
  };
  stagnation: {
    severity: StagnationSeverity;
    signal_count: number;
  };
  latest_assessment: {
    character: Character;
    escalation_score: number;
    assessed_at: string;
    reasoning: AssessmentReasoning;
  };
  members: TopicMember[];
  history: AssessmentHistoryEntry[];
};
