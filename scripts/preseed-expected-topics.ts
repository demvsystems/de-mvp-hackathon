// Preseed the `topics` table with the gold-standard clusters from
// `fixtures/expected-links.json` so the reviewer can be exercised against
// known-correct topics while real topic-discovery is still being tuned.
//
// Re-runnable. Each run wipes existing topics + their `discusses` edges +
// topic_assessments (assessments would otherwise dangle) and re-seeds.
//
// Usage: pnpm db:preseed-topics

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ExpectedMember {
  source: 'intercom' | 'jira' | 'slack' | 'upvoty';
  external_id: string;
}

interface ExpectedCluster {
  id: string;
  label: string;
  description: string;
  evidence_keywords: string[];
  members: ExpectedMember[];
}

interface ExpectedLinks {
  clusters: ExpectedCluster[];
}

interface ResolvedCluster extends ExpectedCluster {
  topic_id: string;
  resolved: { member: ExpectedMember; record_id: string }[];
  missing: ExpectedMember[];
}

interface ActivityStats {
  first_activity_at: string | null;
  last_activity_at: string | null;
  velocity_24h: number;
  velocity_7d_avg: number;
  spread_24h: number;
  unique_authors_7d: number;
  activity_trend: 'growing' | 'stable' | 'declining' | 'dormant';
  stagnation_signal_count: number;
  stagnation_severity: 'none' | 'low' | 'medium' | 'high';
}

// Author IDs are nested differently per source; pragmatic best-effort that's
// good enough for the demo's uniqueness count.
function authorOf(source: string, payload: Record<string, unknown>): string | null {
  if (source === 'slack' || source === 'upvoty') {
    return (payload['author_id'] as string | undefined) ?? null;
  }
  if (source === 'jira') {
    return (
      (payload['reporter'] as string | undefined) ??
      (payload['assignee'] as string | undefined) ??
      null
    );
  }
  if (source === 'intercom') {
    const author = payload['author'] as { id?: string } | undefined;
    return author?.id ?? null;
  }
  return null;
}

function computeActivity(
  raw: {
    id: string;
    source: string;
    created_at: Date | string;
    payload: Record<string, unknown>;
  }[],
): ActivityStats {
  const records = raw.map((r) => ({
    ...r,
    created_at: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
  if (records.length === 0) {
    return {
      first_activity_at: null,
      last_activity_at: null,
      velocity_24h: 0,
      velocity_7d_avg: 0,
      spread_24h: 0,
      unique_authors_7d: 0,
      activity_trend: 'dormant',
      stagnation_signal_count: 0,
      stagnation_severity: 'none',
    };
  }
  const dates = records.map((r) => r.created_at.getTime());
  const lastMs = Math.max(...dates);
  const firstMs = Math.min(...dates);
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  const within24h = records.filter((r) => lastMs - r.created_at.getTime() <= oneDay);
  const within7d = records.filter((r) => lastMs - r.created_at.getTime() <= sevenDays);

  const velocity_24h = within24h.length;
  const velocity_7d_avg = Math.round((within7d.length / 7) * 10) / 10;
  const spread_24h = new Set(within24h.map((r) => r.source)).size;

  const authors = new Set(
    within7d.map((r) => authorOf(r.source, r.payload)).filter((a): a is string => Boolean(a)),
  );
  const unique_authors_7d =
    authors.size > 0 ? authors.size : new Set(within7d.map((r) => r.source)).size;

  let activity_trend: ActivityStats['activity_trend'];
  if (within24h.length > records.length / 2) activity_trend = 'growing';
  else if (within24h.length > 0) activity_trend = 'stable';
  else if (within7d.length > 0) activity_trend = 'declining';
  else activity_trend = 'dormant';

  const stagnation_severity: ActivityStats['stagnation_severity'] =
    activity_trend === 'dormant' ? 'low' : 'none';
  const stagnation_signal_count = stagnation_severity === 'none' ? 0 : 1;

  return {
    first_activity_at: new Date(firstMs).toISOString(),
    last_activity_at: new Date(lastMs).toISOString(),
    velocity_24h,
    velocity_7d_avg,
    spread_24h,
    unique_authors_7d,
    activity_trend,
    stagnation_signal_count,
    stagnation_severity,
  };
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile();

  const { sql } = await import('../packages/db/src/client');
  const { publish, TopicCreated, closeConnection } =
    await import('../packages/messaging/src/index');

  const expectedPath = resolve('fixtures/expected-links.json');
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedLinks;

  async function resolveRecordId(m: ExpectedMember): Promise<string | null> {
    switch (m.source) {
      case 'intercom':
        return `intercom:conversation:${m.external_id}`;
      case 'jira':
        return `jira:issue:${m.external_id}`;
      case 'upvoty':
        return `upvoty:post:${m.external_id}`;
      case 'slack': {
        const rows = await sql<{ id: string }[]>`
          SELECT id FROM records
          WHERE source = 'slack' AND payload->>'slack_id' = ${m.external_id}
          LIMIT 1
        `;
        return rows[0]?.id ?? null;
      }
    }
  }

  async function recordExists(id: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`SELECT id FROM records WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  }

  const clusters: ResolvedCluster[] = [];
  for (const c of expected.clusters) {
    const resolved: ResolvedCluster['resolved'] = [];
    const missing: ExpectedMember[] = [];
    for (const m of c.members) {
      const rid = await resolveRecordId(m);
      if (rid && (await recordExists(rid))) {
        resolved.push({ member: m, record_id: rid });
      } else {
        missing.push(m);
      }
    }
    clusters.push({ ...c, topic_id: `topic:expected:${c.id}`, resolved, missing });
  }

  for (const c of clusters) {
    if (c.missing.length > 0) {
      console.warn(
        `[warn] ${c.id}: ${c.missing.length} member(s) not found in records: ${c.missing
          .map((m) => `${m.source}/${m.external_id}`)
          .join(', ')}`,
      );
    }
  }

  // Pull each cluster's member records up-front so we can derive plausible
  // activity stats — there's no online job for velocity/trend yet.
  const activity = new Map<string, ActivityStats>();
  for (const c of clusters) {
    if (c.resolved.length === 0) {
      activity.set(c.topic_id, computeActivity([]));
      continue;
    }
    const ids = c.resolved.map((r) => r.record_id);
    const rows = await sql<
      { id: string; source: string; created_at: string; payload: Record<string, unknown> }[]
    >`SELECT id, source, created_at, payload FROM records WHERE id = ANY(${ids})`;
    activity.set(c.topic_id, computeActivity(rows));
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM topic_assessments`;
    await tx`DELETE FROM edges WHERE type = 'discusses'`;
    await tx`DELETE FROM topics`;

    const now = new Date().toISOString();

    for (const c of clusters) {
      const sources = new Set(c.resolved.map((r) => r.member.source));
      const a = activity.get(c.topic_id)!;
      await tx`
        INSERT INTO topics (
          id, status, label, description,
          discovered_at, discovered_by,
          member_count, source_count, unique_authors_7d,
          first_activity_at, last_activity_at,
          velocity_24h, velocity_7d_avg, spread_24h,
          activity_trend, computed_at,
          stagnation_signal_count, stagnation_severity,
          payload
        ) VALUES (
          ${c.topic_id}, 'active', ${c.label}, ${c.description},
          ${now}, 'preseed:expected-links',
          ${c.resolved.length}, ${sources.size}, ${a.unique_authors_7d},
          ${a.first_activity_at}, ${a.last_activity_at},
          ${a.velocity_24h}, ${a.velocity_7d_avg}, ${a.spread_24h},
          ${a.activity_trend}, ${now},
          ${a.stagnation_signal_count}, ${a.stagnation_severity},
          ${JSON.stringify({ evidence_keywords: c.evidence_keywords, expected_cluster_id: c.id })}::jsonb
        )
      `;

      for (const r of c.resolved) {
        await tx`
          INSERT INTO edges (
            from_id, to_id, type, source,
            confidence, weight,
            valid_from, observed_at,
            evidence
          ) VALUES (
            ${r.record_id}, ${c.topic_id}, 'discusses', 'preseed:expected-links',
            1, 1,
            ${now}, ${now},
            ${JSON.stringify({ external_id: r.member.external_id, source_kind: r.member.source })}::jsonb
          )
        `;
      }
    }
  });

  console.log('Preseeded topics:');
  for (const c of clusters) {
    console.log(
      `  ${c.topic_id}  ${c.label}  members=${c.resolved.length}/${c.members.length}` +
        (c.missing.length > 0 ? '  [INCOMPLETE]' : ''),
    );
  }

  console.log('Publishing TopicCreated events to wake the reviewer...');
  for (const c of clusters) {
    const occurredAt = new Date().toISOString();
    const ack = await publish(TopicCreated, {
      source: 'preseed:expected-links',
      occurred_at: occurredAt,
      subject_id: c.topic_id,
      correlation_id: c.topic_id,
      payload: {
        id: c.topic_id,
        status: 'active',
        discovered_by: 'preseed:expected-links',
        initial_centroid_summary: {
          sample_record_ids: c.resolved.map((r) => r.record_id),
          cluster_size: c.resolved.length,
          intra_cluster_distance_avg: 0,
        },
        centroid: null,
        member_count: c.resolved.length,
      },
    });
    console.log(`  ${c.topic_id}  seq=${ack.seq}  duplicate=${ack.duplicate}`);
  }

  await sql.end();
  await closeConnection();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
