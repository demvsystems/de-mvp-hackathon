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

  await sql.begin(async (tx) => {
    await tx`DELETE FROM topic_assessments`;
    await tx`DELETE FROM edges WHERE type = 'discusses'`;
    await tx`DELETE FROM topics`;

    const now = new Date().toISOString();

    for (const c of clusters) {
      const sources = new Set(c.resolved.map((r) => r.member.source));
      await tx`
        INSERT INTO topics (
          id, status, label, description,
          discovered_at, discovered_by,
          member_count, source_count,
          payload
        ) VALUES (
          ${c.topic_id}, 'active', ${c.label}, ${c.description},
          ${now}, 'preseed:expected-links',
          ${c.resolved.length}, ${sources.size},
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
        centroid_body_only: null,
        member_count_body_only: c.resolved.length,
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
