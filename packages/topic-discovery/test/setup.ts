import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

// .env aus dem Repo-Root laden, damit DATABASE_URL/DATABASE_URL_TEST greifen
const repoRoot = resolve(__dirname, '../../..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const TEST_DB = 'postgres_topic_discovery_test';
const baseUrl = process.env['DATABASE_URL'];

function deriveTestUrl(): string | null {
  const explicit = process.env['DATABASE_URL_TEST'];
  if (explicit) return explicit;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);
}

function deriveAdminUrl(): string | null {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/postgres$1`);
}

const testUrl = deriveTestUrl();
const adminUrl = deriveAdminUrl();

// Skip nur bei *fehlender* DATABASE_URL (CI ohne Postgres-Service). Wenn die
// URL gesetzt ist und der Connect scheitert, ist das ein Setup-Bug — nicht
// silent skippen.
if (!testUrl || !adminUrl) {
  console.warn('[topic-discovery-test] DATABASE_URL nicht gesetzt — Tests werden geskippt');
} else {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    // 42P04 = duplicate_database — DB existiert bereits, weitermachen
    if (code !== '42P04') {
      await admin.end();
      throw new Error(
        `[topic-discovery-test] Postgres unter ${adminUrl} nicht erreichbar oder fehlerhaft. ` +
          `Starte den lokalen Stack mit \`docker-compose up -d\` oder unsette DATABASE_URL ` +
          `um die Tests zu skippen. Original-Fehler: ${(e as Error).message}`,
      );
    }
  } finally {
    await admin.end();
  }

  // Minimales Schema für records/edges/topics. Centroid (vector(1536)) wird
  // weggelassen — recomputeTopicActivity rührt centroid nicht an, und das
  // pgvector-Setup würde diesen Test unnötig komplizieren. WARNUNG: Bei
  // Schema-Änderungen in packages/db/src/schema.ts dieses DDL mitziehen.
  const target = postgres(testUrl, { max: 1, onnotice: () => {} });
  await target.unsafe(`
    CREATE TABLE IF NOT EXISTS records (
      id text PRIMARY KEY,
      type text NOT NULL,
      source text NOT NULL,
      title text,
      body text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      ingested_at timestamptz NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS edges (
      id bigserial PRIMARY KEY,
      from_id text NOT NULL,
      to_id text NOT NULL,
      type text NOT NULL,
      source text NOT NULL,
      confidence real NOT NULL DEFAULT 1.0,
      weight real NOT NULL DEFAULT 1.0,
      valid_from timestamptz NOT NULL,
      valid_to timestamptz,
      observed_at timestamptz NOT NULL,
      evidence jsonb,
      CONSTRAINT edges_uniq UNIQUE (from_id, to_id, type, source)
    );
    CREATE TABLE IF NOT EXISTS topics (
      id text PRIMARY KEY,
      status text NOT NULL,
      label text,
      description text,
      discovered_at timestamptz NOT NULL,
      discovered_by text NOT NULL,
      archived_at timestamptz,
      superseded_by text,
      member_count integer NOT NULL DEFAULT 0,
      source_count integer NOT NULL DEFAULT 0,
      unique_authors_7d integer NOT NULL DEFAULT 0,
      first_activity_at timestamptz,
      last_activity_at timestamptz,
      velocity_24h integer,
      velocity_7d_avg real,
      spread_24h integer,
      activity_trend text,
      computed_at timestamptz,
      stagnation_signal_count integer NOT NULL DEFAULT 0,
      stagnation_severity text NOT NULL DEFAULT 'none',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await target.end();

  // @repo/db liest DATABASE_URL beim ersten Import — Override muss vor jedem
  // Test-File-Import passieren. vitest-setupFiles laufen vor Test-Imports.
  process.env['DATABASE_URL'] = testUrl;
  process.env['TOPIC_DISCOVERY_TEST_LIVE'] = '1';
}
