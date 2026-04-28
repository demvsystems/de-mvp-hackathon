import { parseArgs } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { watch } from 'node:fs';
import { JsonlSource, type ConnectorSpec } from '@repo/connectors';
import { connectors, sourceNames } from './registry';

async function replay(spec: ConnectorSpec, sourceDir: string): Promise<void> {
  const tagged: Array<{ row: { kind: string }; offset: number }> = [];
  for (const [kind, file] of Object.entries(spec.files)) {
    const path = join(sourceDir, file);
    const src = new JsonlSource<Record<string, unknown>>(path);
    for await (const raw of src.rows()) {
      const meta = raw['_meta'] as { emit_at_offset_seconds: number } | undefined;
      const offset = meta?.emit_at_offset_seconds ?? 0;
      tagged.push({ row: { ...(raw as object), kind } as { kind: string }, offset });
    }
  }
  tagged.sort((a, b) => a.offset - b.offset);
  for (const { row } of tagged) {
    const out = spec.handleRow(row);
    process.stdout.write(JSON.stringify(out) + '\n');
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      data: { type: 'string' },
    },
  });
  const cwd = process.env['INIT_CWD'] ?? process.cwd();
  const baseDir = values.data
    ? isAbsolute(values.data)
      ? values.data
      : resolve(cwd, values.data)
    : resolve(cwd, 'synthetic-data');

  const selected = values.source ? [values.source] : sourceNames;
  for (const name of selected) {
    if (!connectors[name]) {
      console.error(`unknown source: ${name}. available: ${sourceNames.join(', ')}`);
      process.exit(2);
    }
  }

  for (const name of selected) {
    const spec = connectors[name]!;
    const sourceDir = join(baseDir, name);
    console.error(`[runner] replay ${name} from ${sourceDir}`);
    await replay(spec, sourceDir);
  }

  for (const name of selected) {
    const spec = connectors[name]!;
    const sourceDir = join(baseDir, name);
    let pending: NodeJS.Timeout | null = null;
    watch(sourceDir, () => {
      if (pending) clearTimeout(pending);
      // Editors fire multiple events per save; coalesce.
      pending = setTimeout(() => {
        pending = null;
        console.error(`[runner] ${name} fixtures changed, replaying`);
        replay(spec, sourceDir).catch((err) => {
          console.error(`[runner] ${name} replay failed:`, err);
        });
      }, 100);
    });
  }

  console.error(`[runner] watching ${selected.join(', ')} (Ctrl+C to exit)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
