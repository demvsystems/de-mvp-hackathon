// Promote a corrected `topic_feedback` row into an eval fixture.
//
// Usage: pnpm feedback:promote <feedback_id> [--category edge|happy|adversarial]
//
// Reads the feedback row, joins the matching assessment, snapshots the topic +
// linked records + edges via the live DB, writes an eval fixture line into
// eval/golden/<category>.jsonl using the corrected character/escalation as
// `expected`. Marks the feedback row as `reviewed` on success.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CliArgs {
  feedbackId: string;
  category: 'happy' | 'edge' | 'adversarial';
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== undefined && a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, 'true');
      }
    }
  }
  const feedbackId = positional[0];
  if (!feedbackId) throw new Error('usage: feedback-to-fixture <feedback_id> [--category ...]');
  const category = (flags.get('category') ?? 'edge') as CliArgs['category'];
  if (!['happy', 'edge', 'adversarial'].includes(category)) {
    throw new Error(`invalid --category: ${category}`);
  }
  return { feedbackId, category };
}

interface FeedbackRow {
  id: string;
  topic_id: string;
  assessor: string;
  assessed_at: Date;
  thumb: string | null;
  rating: number | null;
  corrected_character: string | null;
  corrected_escalation_score: number | null;
  note: string | null;
  status: string;
  current_character: string;
  current_escalation_score: number;
}

interface TopicRow {
  id: string;
  status: string;
  label: string | null;
  description: string | null;
  discovered_at: Date;
  discovered_by: string;
  member_count: number;
  source_count: number;
  unique_authors_7d: number;
  first_activity_at: Date | null;
  last_activity_at: Date | null;
  velocity_24h: number | null;
  velocity_7d_avg: number | null;
  spread_24h: number | null;
  activity_trend: string | null;
  computed_at: Date | null;
  stagnation_signal_count: number;
  stagnation_severity: string;
  payload: unknown;
}

interface RecordRow {
  id: string;
  type: string;
  source: string;
  title: string | null;
  body: string | null;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
}

interface EdgeRow {
  from_id: string;
  to_id: string;
  type: string;
  source: string;
  confidence: number;
  weight: number;
  valid_from: Date;
  valid_to: Date | null;
  observed_at: Date;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile();

  const args = parseArgs(process.argv.slice(2));
  const { sql } = await import('../packages/db/src/client');

  const [feedback] = await sql<FeedbackRow[]>`
    SELECT f.id::text                     AS id,
           f.topic_id                     AS topic_id,
           f.assessor                     AS assessor,
           f.assessed_at                  AS assessed_at,
           f.thumb                        AS thumb,
           f.rating                       AS rating,
           f.corrected_character          AS corrected_character,
           f.corrected_escalation_score   AS corrected_escalation_score,
           f.note                         AS note,
           f.status                       AS status,
           a.character                    AS current_character,
           a.escalation_score             AS current_escalation_score
      FROM topic_feedback f
      JOIN topic_assessments a
        ON a.topic_id = f.topic_id
       AND a.assessor = f.assessor
       AND a.assessed_at = f.assessed_at
     WHERE f.id = ${args.feedbackId}::bigint
  `;
  if (!feedback) throw new Error(`feedback id ${args.feedbackId} not found`);

  if (feedback.corrected_character === null && feedback.corrected_escalation_score === null) {
    throw new Error(
      `feedback ${args.feedbackId} has no corrections to promote (need character or escalation)`,
    );
  }

  const [topic] = await sql<TopicRow[]>`
    SELECT id, status, label, description, discovered_at, discovered_by,
           member_count, source_count, unique_authors_7d,
           first_activity_at, last_activity_at,
           velocity_24h, velocity_7d_avg, spread_24h, activity_trend, computed_at,
           stagnation_signal_count, stagnation_severity, payload
      FROM topics WHERE id = ${feedback.topic_id}
  `;
  if (!topic) throw new Error(`topic ${feedback.topic_id} not found`);

  const edges = await sql<EdgeRow[]>`
    SELECT from_id, to_id, type, source, confidence, weight,
           valid_from, valid_to, observed_at
      FROM edges
     WHERE to_id = ${feedback.topic_id}
       AND type = 'discusses'
       AND valid_to IS NULL
  `;
  const recordIds = edges.map((e) => e.from_id);
  const records: RecordRow[] = recordIds.length
    ? await sql<RecordRow[]>`
        SELECT id, type, source, title, body, payload, created_at, updated_at
          FROM records
         WHERE id = ANY(${recordIds})
           AND is_deleted = false
      `
    : [];

  const expectedCharacter = feedback.corrected_character ?? feedback.current_character;
  const expectedEscalation =
    feedback.corrected_escalation_score ?? feedback.current_escalation_score;

  const fixtureId = `feedback-${feedback.id}-${expectedCharacter}`;
  const fixture = {
    id: fixtureId,
    category: args.category,
    notes: feedback.note ?? `promoted from feedback ${feedback.id}`,
    topic: {
      id: topic.id,
      status: 'active' as const,
      label: topic.label,
      description: topic.description,
      discovered_at: topic.discovered_at.toISOString(),
      discovered_by: topic.discovered_by,
      member_count: topic.member_count,
      source_count: topic.source_count,
      unique_authors_7d: topic.unique_authors_7d,
      first_activity_at: iso(topic.first_activity_at),
      last_activity_at: iso(topic.last_activity_at),
      velocity_24h: topic.velocity_24h,
      velocity_7d_avg: topic.velocity_7d_avg,
      spread_24h: topic.spread_24h,
      activity_trend: topic.activity_trend,
      computed_at: iso(topic.computed_at),
      stagnation_signal_count: topic.stagnation_signal_count,
      stagnation_severity: topic.stagnation_severity,
      payload: topic.payload ?? {},
    },
    records: records.map((r) => ({
      id: r.id,
      type: r.type,
      source: r.source,
      title: r.title,
      body: r.body,
      payload: r.payload ?? {},
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
    edges: edges.map((e) => ({
      from_id: e.from_id,
      to_id: e.to_id,
      type: e.type,
      source: e.source,
      confidence: e.confidence,
      weight: e.weight,
      valid_from: e.valid_from.toISOString(),
      valid_to: iso(e.valid_to),
      observed_at: e.observed_at.toISOString(),
    })),
    expected: {
      character: expectedCharacter,
      escalation_score: expectedEscalation,
      anchor_record_ids: [],
      expected_signals: [],
      tool_calls: { required: ['get_topics', 'get_records'], forbidden: [] },
    },
  };

  const goldenDir = resolve(process.cwd(), 'eval/golden');
  const targetFile = resolve(goldenDir, `${args.category}.jsonl`);
  if (!existsSync(targetFile)) {
    throw new Error(`fixture file not found: ${targetFile}`);
  }
  const existing = readFileSync(targetFile, 'utf8');
  if (existing.includes(`"id":"${fixtureId}"`)) {
    throw new Error(`fixture ${fixtureId} already exists in ${targetFile}`);
  }
  const line = JSON.stringify(fixture);
  appendFileSync(targetFile, (existing.endsWith('\n') ? '' : '\n') + line + '\n');

  await sql`
    UPDATE topic_feedback
       SET status = 'reviewed', reviewed_at = NOW()
     WHERE id = ${args.feedbackId}::bigint
  `;

  console.log(
    JSON.stringify({
      msg: 'feedback promoted to fixture',
      fixture_id: fixtureId,
      file: targetFile,
      records: records.length,
      edges: edges.length,
      expected_character: expectedCharacter,
      expected_escalation_score: expectedEscalation,
    }),
  );
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
