import 'server-only';

import { sql } from '@repo/db';

export interface OpenFeedback {
  id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: string;
  trace_id: string | null;
  created_at: string;
  thumb: 'up' | 'down' | null;
  rating: number | null;
  corrected_character: string | null;
  corrected_escalation_score: number | null;
  note: string | null;
  current_character: string | null;
  current_escalation_score: number | null;
}

export interface OpenGuardrailEvent {
  id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: string;
  trace_id: string | null;
  created_at: string;
  stage: string;
  rule_id: string;
  severity: 'info' | 'warn' | 'error';
  decision: 'allow' | 'flag' | 'downgrade' | 'block';
  detail: string;
  record_ids: string[];
}

export interface OpenGoldenCandidate {
  id: string;
  feedback_id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: string;
  trace_id: string | null;
  category: string;
  reason: string;
  note: string | null;
  created_at: string;
}

interface OpenFeedbackRow {
  id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: Date | string;
  trace_id: string | null;
  created_at: Date | string;
  thumb: string | null;
  rating: number | null;
  corrected_character: string | null;
  corrected_escalation_score: number | null;
  note: string | null;
  current_character: string | null;
  current_escalation_score: number | null;
}

interface OpenGuardrailEventRow {
  id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: Date | string;
  trace_id: string | null;
  created_at: Date | string;
  stage: string;
  rule_id: string;
  severity: string;
  decision: string;
  detail: string;
  record_ids: unknown;
}

interface OpenGoldenCandidateRow {
  id: string;
  feedback_id: string;
  topic_id: string;
  topic_label: string | null;
  assessor: string;
  assessed_at: Date | string;
  trace_id: string | null;
  category: string;
  reason: string;
  note: string | null;
  created_at: Date | string;
}

function asThumb(value: string | null): 'up' | 'down' | null {
  return value === 'up' || value === 'down' ? value : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asSeverity(value: string): 'info' | 'warn' | 'error' {
  return value === 'error' || value === 'warn' ? value : 'info';
}

function asDecision(value: string): 'allow' | 'flag' | 'downgrade' | 'block' {
  return value === 'flag' || value === 'downgrade' || value === 'block' ? value : 'allow';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export async function listOpenFeedback(): Promise<OpenFeedback[]> {
  // bigint serialised as string by postgres-js to avoid precision loss.
  const rows = await sql<OpenFeedbackRow[]>`
    SELECT f.id::text                  AS id,
           f.topic_id                  AS topic_id,
           t.label                     AS topic_label,
           f.assessor                  AS assessor,
           f.assessed_at               AS assessed_at,
           f.trace_id                  AS trace_id,
           f.created_at                AS created_at,
           f.thumb                     AS thumb,
           f.rating                    AS rating,
           f.corrected_character       AS corrected_character,
           f.corrected_escalation_score AS corrected_escalation_score,
           f.note                      AS note,
           a.character                 AS current_character,
           a.escalation_score          AS current_escalation_score
      FROM topic_feedback f
      LEFT JOIN topics t ON t.id = f.topic_id
      LEFT JOIN topic_assessments a
             ON a.topic_id = f.topic_id
            AND a.assessor = f.assessor
            AND a.assessed_at = f.assessed_at
     WHERE f.status = 'open'
       AND (
            f.thumb = 'down'
         OR (f.rating IS NOT NULL AND f.rating <= 2)
         OR f.corrected_character IS NOT NULL
         OR f.corrected_escalation_score IS NOT NULL
       )
     ORDER BY f.created_at DESC
     LIMIT 200
  `;

  return rows.map((r) => ({
    id: r.id,
    topic_id: r.topic_id,
    topic_label: r.topic_label,
    assessor: r.assessor,
    assessed_at: toIso(r.assessed_at),
    trace_id: r.trace_id,
    created_at: toIso(r.created_at),
    thumb: asThumb(r.thumb),
    rating: r.rating,
    corrected_character: r.corrected_character,
    corrected_escalation_score: r.corrected_escalation_score,
    note: r.note,
    current_character: r.current_character,
    current_escalation_score: r.current_escalation_score,
  }));
}

export async function listOpenGuardrailEvents(): Promise<OpenGuardrailEvent[]> {
  const rows = await sql<OpenGuardrailEventRow[]>`
    SELECT g.id::text    AS id,
           g.topic_id    AS topic_id,
           t.label       AS topic_label,
           g.assessor    AS assessor,
           g.assessed_at AS assessed_at,
           g.trace_id    AS trace_id,
           g.created_at  AS created_at,
           g.stage       AS stage,
           g.rule_id     AS rule_id,
           g.severity    AS severity,
           g.decision    AS decision,
           g.detail      AS detail,
           g.record_ids  AS record_ids
      FROM guardrail_events g
      LEFT JOIN topics t ON t.id = g.topic_id
     WHERE g.status = 'open'
     ORDER BY g.created_at DESC
     LIMIT 200
  `;

  return rows.map((row) => ({
    id: row.id,
    topic_id: row.topic_id,
    topic_label: row.topic_label,
    assessor: row.assessor,
    assessed_at: toIso(row.assessed_at),
    trace_id: row.trace_id,
    created_at: toIso(row.created_at),
    stage: row.stage,
    rule_id: row.rule_id,
    severity: asSeverity(row.severity),
    decision: asDecision(row.decision),
    detail: row.detail,
    record_ids: asStringArray(row.record_ids),
  }));
}

export async function listOpenGoldenCandidates(): Promise<OpenGoldenCandidate[]> {
  const rows = await sql<OpenGoldenCandidateRow[]>`
    SELECT c.id::text      AS id,
           c.feedback_id   AS feedback_id,
           c.topic_id      AS topic_id,
           t.label         AS topic_label,
           c.assessor      AS assessor,
           c.assessed_at   AS assessed_at,
           c.trace_id      AS trace_id,
           c.category      AS category,
           c.reason        AS reason,
           c.note          AS note,
           c.created_at    AS created_at
      FROM golden_example_candidates c
      LEFT JOIN topics t ON t.id = c.topic_id
     WHERE c.status = 'open'
     ORDER BY c.created_at DESC
     LIMIT 200
  `;

  return rows.map((row) => ({
    id: row.id,
    feedback_id: row.feedback_id,
    topic_id: row.topic_id,
    topic_label: row.topic_label,
    assessor: row.assessor,
    assessed_at: toIso(row.assessed_at),
    trace_id: row.trace_id,
    category: row.category,
    reason: row.reason,
    note: row.note,
    created_at: toIso(row.created_at),
  }));
}
