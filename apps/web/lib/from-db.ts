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

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// TODO(connector-handoff): see types.ts. Slack mapping mirrors the actual
// connector payload; the others are best-effort guesses against r.payload until
// the real connectors land. Update when each connector ships.
function toMember(r: {
  id: string;
  type: string;
  source: string;
  title: string | null;
  body: string | null;
  payload: unknown;
  createdAt: Date;
  edge_confidence: number | null;
}): TopicMember | null {
  const snippet = (r.body ?? r.title ?? '').slice(0, 280);
  const base = {
    id: r.id,
    occurred_at: r.createdAt.toISOString(),
    title: r.title,
    body_snippet: snippet,
    edge_confidence: r.edge_confidence ?? 1,
    author_display_name: null,
    permalink: null,
  } as const;
  const p = asObj(r.payload);

  switch (r.source) {
    case 'slack': {
      if (r.type !== 'message') return null;
      return {
        ...base,
        source: 'slack',
        type: 'message',
        payload: {
          workspace_id: str(p['workspace_id']) ?? '',
          channel_id: str(p['channel_id']) ?? '',
          channel_name: null,
          thread_ts: str(p['thread_ts']),
          ts: str(p['ts']) ?? '',
          reply_count: 0,
        },
      };
    }
    case 'intercom': {
      if (r.type !== 'conversation' && r.type !== 'message') return null;
      return {
        ...base,
        source: 'intercom',
        type: r.type,
        payload: {
          conversation_id: str(p['conversation_id']) ?? '',
        },
      };
    }
    case 'jira': {
      if (r.type !== 'issue' && r.type !== 'comment') return null;
      return {
        ...base,
        source: 'jira',
        type: r.type,
        payload: {
          issue_key: str(p['issue_key']) ?? '',
          project_key: str(p['project_key']) ?? '',
          ...(str(p['issue_type']) ? { issue_type: str(p['issue_type'])! } : {}),
          ...(str(p['status']) ? { status: str(p['status'])! } : {}),
          ...(str(p['priority']) ? { priority: str(p['priority'])! } : {}),
        },
      };
    }
    case 'github': {
      if (r.type !== 'pr' && r.type !== 'issue' && r.type !== 'comment' && r.type !== 'review') {
        return null;
      }
      return {
        ...base,
        source: 'github',
        type: r.type,
        payload: {
          repo: str(p['repo']) ?? '',
          number: num(p['number']) ?? 0,
        },
      };
    }
    case 'upvoty': {
      if (r.type !== 'post' && r.type !== 'comment') return null;
      return {
        ...base,
        source: 'upvoty',
        type: r.type,
        payload: {
          board_id: str(p['board_id']) ?? '',
          board_name: null,
          post_id: str(p['post_id']) ?? '',
        },
      };
    }
    default:
      return null;
  }
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

  const members: TopicMember[] = memberRows
    .map((r): TopicMember | null => toMember(r))
    .filter((m): m is TopicMember => m !== null);

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
      assessor: latest?.assessor ?? '',
      trace_id: latest?.traceId ?? null,
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
