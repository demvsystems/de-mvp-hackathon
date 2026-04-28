// Moves a Langfuse prompt label to a specific version. Versions are immutable;
// labels are deployment pointers. Promoting `staging` → `production` is a
// label-move, not a re-sync.
//
// Usage:
//   pnpm prompts:promote --name reviewer.system --version 2 --label production
//
// Idempotent: re-running with the same args is a no-op (the label already
// points where you asked).

import { LangfuseClient } from '@langfuse/client';
import { z } from 'zod';

const Args = z.object({
  name: z.string().min(1),
  version: z.coerce.number().int().positive(),
  label: z.string().min(1),
});

function parseArgs(argv: string[]): z.infer<typeof Args> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg === 'string' && arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      }
    }
  }
  return Args.parse(flags);
}

async function main(): Promise<void> {
  const { name, version, label } = parseArgs(process.argv.slice(2));

  const secret = process.env['LANGFUSE_SECRET_KEY'];
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  if (!secret || !publicKey) {
    throw new Error('LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set (see .env.example).');
  }

  const lf = new LangfuseClient({
    publicKey,
    secretKey: secret,
    ...((process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST']) !== undefined
      ? { baseUrl: process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'] }
      : {}),
  });

  const current = await lf.prompt.get(name, { version, type: 'text', cacheTtlSeconds: 0 });
  const existing = current.promptResponse.labels.filter((l) => l !== 'latest');
  const newLabels = existing.includes(label) ? existing : [...existing, label];

  await lf.prompt.update({ name, version, newLabels });

  console.log(
    JSON.stringify({
      msg: 'label moved',
      name,
      version,
      previousLabels: existing,
      newLabels,
    }),
  );

  await lf.shutdown();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
