import 'server-only';

import { read } from '@repo/db';
import type {
  ActivityTrend,
  AssessmentReasoning,
  Character,
  StagnationSeverity,
  TopicContext,
  TopicMember,
  TriageTopic,
} from './types';

const characters: Character[] = ['attention', 'opportunity', 'noteworthy', 'calm'];
const trends: ActivityTrend[] = ['growing', 'stable', 'declining', 'dormant'];
const stagnationSeverities: StagnationSeverity[] = ['none', 'low', 'medium', 'high'];

function asCharacter(value: string | null | undefined): Character {
  return (characters as string[]).includes(value ?? '') ? (value as Character) : 'noteworthy';
}

function asTrend(value: string | null | undefined): ActivityTrend {
  return (trends as string[]).includes(value ?? '') ? (value as ActivityTrend) : 'stable';
}

function asSeverity(value: string | null | undefined): StagnationSeverity {
  return (stagnationSeverities as string[]).includes(value ?? '')
    ? (value as StagnationSeverity)
    : 'none';
}

function asReasoning(value: unknown): AssessmentReasoning {
  const obj = (value ?? {}) as Record<string, unknown>;
  // Reviewer publishes `summary`; legacy fixtures used `sentiment_aggregate`.
  // Bridge both into the UI's `sentiment_aggregate` slot.
  const summary =
    typeof obj['summary'] === 'string'
      ? (obj['summary'] as string)
      : typeof obj['sentiment_aggregate'] === 'string'
        ? (obj['sentiment_aggregate'] as string)
        : '';
  const signals = Array.isArray(obj['key_signals']) ? (obj['key_signals'] as string[]) : [];
  const artifacts = Array.isArray(obj['key_artifacts']) ? (obj['key_artifacts'] as string[]) : [];
  const notes = typeof obj['additional_notes'] === 'string' ? obj['additional_notes'] : undefined;
  return {
    sentiment_aggregate: summary,
    key_signals: signals,
    key_artifacts: artifacts,
    ...(notes !== undefined ? { additional_notes: notes } : {}),
  };
}

export async function getScoreboard(): Promise<TriageTopic[]> {
  const rows = await read.listActiveTopics({ recent_assessments_limit: 1 });
  const out: TriageTopic[] = [];
  for (const { topic, recent_assessments } of rows) {
    const latest = recent_assessments[0];
    if (!latest) continue;
    const reasoning = asReasoning(latest.reasoning);
    out.push({
      id: topic.id,
      type: 'topic',
      title: topic.label ?? topic.id,
      snippet: reasoning.sentiment_aggregate || (topic.description ?? null),
      source: 'topic',
      scoring: {
        score: latest.escalationScore,
        matched_via: [{ type: 'topic_membership', topic_id: topic.id, topic_confidence: 1.0 }],
      },
      metadata: {
        character: asCharacter(latest.character),
        reasoning,
        last_activity_at: (topic.lastActivityAt ?? topic.discoveredAt).toISOString(),
        member_count: topic.memberCount,
        source_count: topic.sourceCount,
        stagnation_severity: asSeverity(topic.stagnationSeverity),
      },
    });
  }
  return out;
}

export async function getTopic(id: string): Promise<TopicContext | null> {
  const [topicRow] = await read.getTopics({ ids: [id], recent_assessments_limit: 10 });
  if (!topicRow) return null;
  const { topic, recent_assessments } = topicRow;
  const latest = recent_assessments[0];

  const memberRows = await read.getRecords({
    topic_id: id,
    sort_by: 'edge_confidence',
    order: 'desc',
    limit: 25,
  });

  const members: TopicMember[] = memberRows.map((r): TopicMember => {
    const snippet = (r.body ?? r.title ?? '').slice(0, 280);
    return {
      id: r.id,
      type: r.type,
      source: r.source as TopicMember['source'],
      title: r.title,
      body_snippet: snippet,
      author_display_name: null,
      occurred_at: r.createdAt.toISOString(),
      edge_confidence: r.edge_confidence ?? 1,
    };
  });

  const latestReasoning = asReasoning(latest?.reasoning);
  const lastActivity = (topic.lastActivityAt ?? topic.discoveredAt).toISOString();

  return {
    id: topic.id,
    label: topic.label ?? topic.id,
    status: (topic.status as TopicContext['status']) ?? 'active',
    discovered_at: topic.discoveredAt.toISOString(),
    discovered_by: topic.discoveredBy,
    activity: {
      member_count: topic.memberCount,
      source_count: topic.sourceCount,
      unique_authors_7d: topic.uniqueAuthors7d,
      velocity_24h: topic.velocity24h ?? 0,
      velocity_7d_avg: topic.velocity7dAvg ?? 0,
      trend: asTrend(topic.activityTrend),
      last_activity_at: lastActivity,
    },
    stagnation: {
      severity: asSeverity(topic.stagnationSeverity),
      signal_count: topic.stagnationSignalCount,
    },
    latest_assessment: {
      character: asCharacter(latest?.character),
      escalation_score: latest?.escalationScore ?? 0,
      assessed_at: latest?.assessedAt.toISOString() ?? topic.discoveredAt.toISOString(),
      reasoning: latestReasoning,
    },
    members,
    history: recent_assessments.map((a) => {
      const r = asReasoning(a.reasoning);
      return {
        assessed_at: a.assessedAt.toISOString(),
        character: asCharacter(a.character),
        escalation_score: a.escalationScore,
        brief_reasoning: r.sentiment_aggregate.slice(0, 240),
      };
    }),
  };
}
