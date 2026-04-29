/**
 * Shapes mirror the documented Tool-Layer responses (docs/rough-design/06_tool_layer.md
 * and 03_materialisierer.md). Keep these aligned so the frontend can switch from
 * fixtures to live `/tools/*` calls without touching the UI.
 */

// =============================================================================
// TODO(connector-handoff): the per-source TopicMember variants below are
// PLACEHOLDERS. Only the Slack variant is grounded in the actual ingest
// (packages/connectors/src/slack). Intercom / Jira / GitHub / Upvoty connectors
// are being built in parallel by another dev — once they land, replace these
// shapes with whatever those connectors actually write into `records.payload`.
//
// The base fields (id, source, occurred_at, title, body_snippet,
// edge_confidence, author_display_name, permalink) are safe regardless and the
// renderer only depends on those today, so changing payload shapes later is
// low blast radius. But:
//   - field NAMES below are predictions, not contracts
//   - "joined" fields (author_display_name, channel_name, board_name,
//     reply_count) require the read endpoint to traverse edges; today it
//     doesn't, so they all come back null/0
//   - permalink synthesis needs source-specific glue per source; today null
// =============================================================================

export type Source = 'slack' | 'intercom' | 'jira' | 'github' | 'upvoty' | 'topic';

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

type TopicMemberBase = {
  id: string;
  occurred_at: string;
  title: string | null;
  body_snippet: string;
  edge_confidence: number;
  // Resolved by the read endpoint via edges/derivation (not yet — TODO above).
  author_display_name: string | null;
  permalink: string | null;
};

export type SlackMember = TopicMemberBase & {
  source: 'slack';
  type: 'message';
  payload: {
    workspace_id: string;
    channel_id: string;
    channel_name: string | null; // joined via posted_in → channel
    thread_ts: string | null;
    ts: string;
    reply_count: number; // derived: count(replies_to → me)
  };
};

export type IntercomMember = TopicMemberBase & {
  source: 'intercom';
  type: 'conversation' | 'message';
  payload: {
    conversation_id: string;
    state?: 'open' | 'closed' | 'snoozed';
    channel?: 'email' | 'chat' | 'in-app';
    customer_display_name?: string | null;
    last_message_role?: 'customer' | 'teammate';
  };
};

export type JiraMember = TopicMemberBase & {
  source: 'jira';
  type: 'issue' | 'comment';
  payload: {
    issue_key: string;
    project_key: string;
    issue_type?: string;
    status?: string;
    priority?: string;
    assignee_display_name?: string | null;
    sprint_name?: string | null;
  };
};

export type GithubMember = TopicMemberBase & {
  source: 'github';
  type: 'pr' | 'issue' | 'comment' | 'review';
  payload: {
    repo: string;
    number: number;
    state?: 'open' | 'closed' | 'merged' | 'draft';
    labels?: string[];
  };
};

export type UpvotyMember = TopicMemberBase & {
  source: 'upvoty';
  type: 'post' | 'comment';
  payload: {
    board_id: string;
    board_name: string | null;
    post_id: string;
    status?: string;
    vote_count?: number;
  };
};

export type TopicMember = SlackMember | IntercomMember | JiraMember | GithubMember | UpvotyMember;

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
    assessor: string;
    trace_id: string | null;
    reasoning: AssessmentReasoning;
  };
  members: TopicMember[];
  history: AssessmentHistoryEntry[];
};
