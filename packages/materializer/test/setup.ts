import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

// .env aus dem Repo-Root laden, damit DATABASE_URL/DATABASE_URL_TEST greifen
const repoRoot = resolve(__dirname, '../../..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const TEST_DB = 'postgres_materializer_test';
const baseUrl = process.env['DATABASE_URL'];

function deriveTestUrl(): string | null {
  const explicit = process.env['DATABASE_URL_TEST'];
  if (explicit) return explicit;
  if (!baseUrl) return null;
  // Letzten Pfad-Teil (DB-Name) durch TEST_DB ersetzen, Query-String erhalten
  return baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);
}

function deriveAdminUrl(): string | null {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/postgres$1`);
}

const testUrl = deriveTestUrl();
const adminUrl = deriveAdminUrl();

// Skip nur bei *fehlender* DATABASE_URL (CI ohne Postgres-Service). Wenn die
// URL *gesetzt* ist und der Connect scheitert, ist das ein Setup-Bug — nicht
// silent skippen, sonst pusht jemand grün ohne dass die Tests gelaufen sind.
if (!testUrl || !adminUrl) {
  console.warn('[materializer-test] DATABASE_URL nicht gesetzt — Tests werden geskippt');
} else {
  // Schritt 1: Test-DB anlegen (idempotent)
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    // 42P04 = duplicate_database — DB existiert bereits, weitermachen
    if (code !== '42P04') {
      await admin.end();
      throw new Error(
        `[materializer-test] Postgres unter ${adminUrl} nicht erreichbar oder fehlerhaft. ` +
          `Starte den lokalen Stack mit \`docker-compose up -d\` oder unsette DATABASE_URL ` +
          `um die Tests zu skippen. Original-Fehler: ${(e as Error).message}`,
      );
    }
  } finally {
    await admin.end();
  }

  // Schritt 2: Minimales Schema für records + edges spiegeln. Generated Columns
  // (search_vector) und Indizes weglassen — wir testen die Materializer-SQL,
  // nicht die Suche. WARNUNG: Bei Schema-Änderungen in
  // packages/db/src/schema.ts dieses DDL mitziehen (siehe AGENTS.md).
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
  `);
  await target.end();

  // @repo/db liest DATABASE_URL beim ersten Import — Override muss vor jedem
  // Test-File-Import passieren. vitest-setupFiles laufen vor Test-Imports.
  process.env['DATABASE_URL'] = testUrl;
  process.env['MATERIALIZER_TEST_LIVE'] = '1';
}
