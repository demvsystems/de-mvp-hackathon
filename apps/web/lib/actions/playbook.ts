'use server';

import { revalidatePath } from 'next/cache';
import { db, eq, schema, drizzleSql } from '@repo/db';
import { Playbook, PLAYBOOK_ID } from '@repo/agent/shared';
import { z } from 'zod';

export interface PlaybookSaveResult {
  ok: boolean;
  error?: string;
  version?: number;
}

const SaveInput = z.object({
  playbook_json: z.string().min(1),
});

export async function savePlaybook(raw: z.infer<typeof SaveInput>): Promise<PlaybookSaveResult> {
  const parsed = SaveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid input' };

  let asObject: unknown;
  try {
    asObject = JSON.parse(parsed.data.playbook_json);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const validated = Playbook.safeParse(asObject);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  const updated = await db
    .update(schema.companyPlaybook)
    .set({
      playbook: validated.data as unknown,
      version: drizzleSql`${schema.companyPlaybook.version} + 1`,
      updatedAt: new Date(),
      updatedBy: 'web:human',
    })
    .where(eq(schema.companyPlaybook.id, PLAYBOOK_ID))
    .returning({ version: schema.companyPlaybook.version });

  if (updated.length === 0) {
    // Row doesn't exist yet — insert.
    const inserted = await db
      .insert(schema.companyPlaybook)
      .values({
        id: PLAYBOOK_ID,
        playbook: validated.data as unknown,
        version: 1,
        updatedBy: 'web:human',
      })
      .returning({ version: schema.companyPlaybook.version });
    revalidatePath('/playbook');
    return { ok: true, version: inserted[0]!.version };
  }

  revalidatePath('/playbook');
  return { ok: true, version: updated[0]!.version };
}
