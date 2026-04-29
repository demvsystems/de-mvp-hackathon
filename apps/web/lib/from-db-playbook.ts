import 'server-only';

import { db, eq, schema } from '@repo/db';
import { DEFAULT_PLAYBOOK, Playbook, PLAYBOOK_ID } from '@repo/agent/shared';

export interface PlaybookRow {
  id: string;
  playbook: Playbook;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export async function getPlaybook(): Promise<PlaybookRow | null> {
  const rows = await db
    .select()
    .from(schema.companyPlaybook)
    .where(eq(schema.companyPlaybook.id, PLAYBOOK_ID))
    .limit(1);
  if (rows.length === 0) {
    return {
      id: PLAYBOOK_ID,
      playbook: DEFAULT_PLAYBOOK,
      version: 1,
      updated_at: new Date(0).toISOString(),
      updated_by: 'system:default',
    };
  }
  const r = rows[0]!;
  const parsed = Playbook.safeParse(r.playbook);
  if (!parsed.success) {
    return {
      id: PLAYBOOK_ID,
      playbook: DEFAULT_PLAYBOOK,
      version: r.version,
      updated_at: r.updatedAt.toISOString(),
      updated_by: r.updatedBy,
    };
  }
  return {
    id: r.id,
    playbook: parsed.data,
    version: r.version,
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}
