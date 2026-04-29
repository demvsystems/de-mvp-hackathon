import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@repo/db';
import { recomputeTopicActivity } from '../src/activity';

const LIVE = process.env['TOPIC_DISCOVERY_TEST_LIVE'] === '1';
const describeIfLive = LIVE ? describe : describe.skip;

const TOPIC_ID = 'topic:test:activity';
const NOW = new Date();
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const DAYS_AGO = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000).toISOString();

async function reset() {
  await sql`DELETE FROM edges WHERE to_id = ${TOPIC_ID} OR from_id LIKE 'rec:test:%'`;
  await sql`DELETE FROM records WHERE id LIKE 'rec:test:%'`;
  await sql`DELETE FROM topics WHERE id = ${TOPIC_ID}`;
}

async function insertTopic() {
  await sql`
    INSERT INTO topics (id, status, discovered_at, discovered_by)
    VALUES (${TOPIC_ID}, 'active', ${NOW.toISOString()}, 'test')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function insertRecord(
  id: string,
  source: string,
  createdAt: string,
  payload: Record<string, unknown> = {},
) {
  await sql`
    INSERT INTO records (id, type, source, title, body, payload,
                         created_at, updated_at, ingested_at)
    VALUES (${id}, 'message', ${source}, null, null, ${JSON.stringify(payload)}::jsonb,
            ${createdAt}, ${createdAt}, ${createdAt})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function insertDiscussesEdge(recordId: string) {
  await sql`
    INSERT INTO edges (from_id, to_id, type, source, valid_from, observed_at)
    VALUES (${recordId}, ${TOPIC_ID}, 'discusses', 'topic-discovery:with-neighbors:v1',
            ${NOW.toISOString()}, ${NOW.toISOString()})
    ON CONFLICT DO NOTHING
  `;
}

async function loadTopic() {
  const rows = await sql<
    {
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
    }[]
  >`SELECT * FROM topics WHERE id = ${TOPIC_ID}`;
  return rows[0]!;
}

describeIfLive('recomputeTopicActivity', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await sql.end({ timeout: 1 });
  });

  it('aggregates member_count, source_count, velocities and last_activity from discusses edges', async () => {
    await insertTopic();
    // 1 record from today (slack), 1 from 3 days ago (jira), 1 from 10 days ago (intercom)
    await insertRecord('rec:test:a', 'slack', HOURS_AGO(2), { author_id: 'U-alice' });
    await insertRecord('rec:test:b', 'jira', DAYS_AGO(3), { reporter: 'U-bob' });
    await insertRecord('rec:test:c', 'intercom', DAYS_AGO(10), { author: { id: 'U-carol' } });
    await insertDiscussesEdge('rec:test:a');
    await insertDiscussesEdge('rec:test:b');
    await insertDiscussesEdge('rec:test:c');

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(3);
    expect(t.source_count).toBe(3);
    expect(t.velocity_24h).toBe(1);
    expect(t.spread_24h).toBe(1);
    // 2 records within 7d (today + 3 days ago) → 2/7 ≈ 0.3
    expect(t.velocity_7d_avg).toBeCloseTo(0.3, 1);
    // unique_authors_7d only counts within-7d records: U-alice + U-bob = 2
    expect(t.unique_authors_7d).toBe(2);
    expect(t.last_activity_at).not.toBeNull();
    expect(t.first_activity_at).not.toBeNull();
    expect(new Date(t.last_activity_at!).getTime()).toBeGreaterThan(
      new Date(t.first_activity_at!).getTime(),
    );
    expect(t.computed_at).not.toBeNull();
    // 1 within-24h out of 3 members → not >50%, but >0 → 'stable'
    expect(t.activity_trend).toBe('stable');
    expect(t.stagnation_severity).toBe('none');
    expect(t.stagnation_signal_count).toBe(0);
  });

  it('marks topics with no recent activity as dormant + low stagnation', async () => {
    await insertTopic();
    await insertRecord('rec:test:old1', 'slack', DAYS_AGO(20));
    await insertRecord('rec:test:old2', 'slack', DAYS_AGO(15));
    await insertDiscussesEdge('rec:test:old1');
    await insertDiscussesEdge('rec:test:old2');

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(2);
    expect(t.velocity_24h).toBe(0);
    expect(t.velocity_7d_avg).toBe(0);
    expect(t.activity_trend).toBe('dormant');
    expect(t.stagnation_severity).toBe('low');
    expect(t.stagnation_signal_count).toBe(1);
  });

  it('classifies bursty 24h activity (>50% of members) as growing', async () => {
    await insertTopic();
    await insertRecord('rec:test:burst1', 'slack', HOURS_AGO(1), { author_id: 'U1' });
    await insertRecord('rec:test:burst2', 'slack', HOURS_AGO(2), { author_id: 'U2' });
    await insertRecord('rec:test:burst3', 'slack', HOURS_AGO(3), { author_id: 'U3' });
    await insertRecord('rec:test:old', 'slack', DAYS_AGO(5), { author_id: 'U4' });
    for (const id of ['rec:test:burst1', 'rec:test:burst2', 'rec:test:burst3', 'rec:test:old']) {
      await insertDiscussesEdge(id);
    }

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(4);
    expect(t.velocity_24h).toBe(3);
    expect(t.activity_trend).toBe('growing');
  });

  it('skips deleted records when aggregating', async () => {
    await insertTopic();
    await insertRecord('rec:test:live', 'slack', HOURS_AGO(2));
    await insertRecord('rec:test:dead', 'slack', HOURS_AGO(2));
    await sql`UPDATE records SET is_deleted = true WHERE id = 'rec:test:dead'`;
    await insertDiscussesEdge('rec:test:live');
    await insertDiscussesEdge('rec:test:dead');

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(1);
  });

  it('skips invalidated edges (valid_to set) when aggregating', async () => {
    await insertTopic();
    await insertRecord('rec:test:active', 'slack', HOURS_AGO(2));
    await insertRecord('rec:test:gone', 'slack', HOURS_AGO(2));
    await insertDiscussesEdge('rec:test:active');
    await insertDiscussesEdge('rec:test:gone');
    await sql`UPDATE edges SET valid_to = ${NOW.toISOString()} WHERE from_id = 'rec:test:gone'`;

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(1);
  });

  it('is a no-op when the topic row does not exist', async () => {
    await recomputeTopicActivity('topic:test:nonexistent');
    const rows = await sql`SELECT 1 FROM topics WHERE id = 'topic:test:nonexistent'`;
    expect(rows.length).toBe(0);
  });

  it('handles topics with no discusses edges (resets to zeros + dormant)', async () => {
    await insertTopic();
    await sql`UPDATE topics SET member_count = 99, activity_trend = 'growing' WHERE id = ${TOPIC_ID}`;

    await recomputeTopicActivity(TOPIC_ID);

    const t = await loadTopic();
    expect(t.member_count).toBe(0);
    expect(t.activity_trend).toBe('dormant');
    // No members → not really stagnating either
    expect(t.stagnation_severity).toBe('none');
  });
});
