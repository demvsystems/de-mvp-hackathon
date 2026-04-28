// Pushes every prompt listed in prompts/meta.yaml to Langfuse, creating a
// new version when the file content has changed. Idempotent — running
// twice in a row is a no-op (Langfuse dedupes by content hash).
//
// For ad-hoc reads/inspection, the langfuse-cli is also available:
//   npx langfuse-cli api prompts get --name reviewer.system
//   npx langfuse-cli api prompts list

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Langfuse } from 'langfuse';
import { parse } from 'yaml';
import { z } from 'zod';

const PromptEntry = z.object({
  name: z.string(),
  file: z.string(),
  type: z.enum(['text', 'chat']).default('text'),
  labels: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  commitMessage: z.string().optional(),
});

const Manifest = z.object({
  prompts: z.array(PromptEntry).min(1),
});

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const promptsDir = resolve(here, '..', 'prompts');
  const manifestPath = resolve(promptsDir, 'meta.yaml');

  const raw = await readFile(manifestPath, 'utf8');
  const parsed: unknown = parse(raw);
  const manifest = Manifest.parse(parsed);

  const secret = process.env['LANGFUSE_SECRET_KEY'];
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  if (!secret || !publicKey) {
    throw new Error('LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set (see .env.example).');
  }

  const lf = new Langfuse({
    secretKey: secret,
    publicKey,
    ...(process.env['LANGFUSE_HOST'] !== undefined
      ? { baseUrl: process.env['LANGFUSE_HOST'] }
      : {}),
  });

  for (const entry of manifest.prompts) {
    if (entry.type !== 'text') {
      throw new Error(`prompt "${entry.name}": only type=text is supported in sync (yet)`);
    }
    const body = await readFile(resolve(promptsDir, entry.file), 'utf8');

    const created = await lf.createPrompt({
      name: entry.name,
      type: 'text',
      prompt: body,
      labels: entry.labels,
      tags: entry.tags,
      ...(entry.commitMessage !== undefined ? { commitMessage: entry.commitMessage } : {}),
    });

    console.log(
      JSON.stringify({
        msg: 'prompt synced',
        name: entry.name,
        version: created.version,
        labels: entry.labels,
      }),
    );
  }

  await lf.shutdownAsync();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
