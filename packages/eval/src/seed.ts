import { sql } from '@repo/db';
import type { Fixture } from './fixture';

export async function truncateAll(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      topic_assessments,
      embeddings,
      edges,
      topics,
      records,
      events_archive
    RESTART IDENTITY CASCADE
  `;
}

export async function seedFixture(fixture: Fixture): Promise<void> {
  const ingestedAt = new Date().toISOString();

  for (const r of fixture.records) {
    await sql`
      INSERT INTO records (id, type, source, title, body, payload,
                           created_at, updated_at, ingested_at, is_deleted)
      VALUES (${r.id}, ${r.type}, ${r.source}, ${r.title}, ${r.body},
              ${JSON.stringify(r.payload)}::jsonb,
              ${r.created_at}, ${r.updated_at}, ${ingestedAt}, false)
      ON CONFLICT (id) DO NOTHING
    `;
  }

  const t = fixture.topic;
  await sql`
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
      ${t.id}, ${t.status}, ${t.label}, ${t.description},
      ${t.discovered_at}, ${t.discovered_by},
      ${t.member_count}, ${t.source_count}, ${t.unique_authors_7d},
      ${t.first_activity_at}, ${t.last_activity_at},
      ${t.velocity_24h}, ${t.velocity_7d_avg}, ${t.spread_24h},
      ${t.activity_trend}, ${t.computed_at},
      ${t.stagnation_signal_count}, ${t.stagnation_severity},
      ${JSON.stringify(t.payload)}::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `;

  for (const e of fixture.edges) {
    await sql`
      INSERT INTO edges (from_id, to_id, type, source,
                         confidence, weight,
                         valid_from, valid_to, observed_at, evidence)
      VALUES (${e.from_id}, ${e.to_id}, ${e.type}, ${e.source},
              ${e.confidence}, ${e.weight},
              ${e.valid_from}, ${e.valid_to}, ${e.observed_at}, NULL)
      ON CONFLICT (from_id, to_id, type, source) DO NOTHING
    `;
  }
}
