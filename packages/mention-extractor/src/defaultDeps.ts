import { sql } from '@repo/db';
import type { ResolverDeps } from './resolver';

/**
 * Production-Adapter: implementiert ResolverDeps gegen die echte
 * records-Tabelle. Gehalten in einem eigenen Modul, damit Tests `index.ts`
 * laden können, ohne dass `@repo/db` (und damit DATABASE_URL) gefordert
 * wird. Backend lädt diese Datei nur, wenn DATABASE_URL gesetzt ist —
 * `requiredEnv` im Worker-Spec sorgt dafür.
 */
export function createDefaultDeps(): ResolverDeps {
  return {
    async queryJiraIssueByKey(key) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id FROM records
        WHERE source = 'jira'
          AND payload->>'key' = ${key}
          AND is_deleted = false
        LIMIT 1
      `;
      return rows[0] ? { id: rows[0].id } : null;
    },
    async queryChannelById(channel) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id FROM records
        WHERE source = 'slack'
          AND type = 'channel'
          AND payload->>'channel_id' = ${channel}
          AND is_deleted = false
        LIMIT 1
      `;
      return rows[0] ? { id: rows[0].id } : null;
    },
  };
}
