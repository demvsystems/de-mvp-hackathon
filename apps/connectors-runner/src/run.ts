import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { watch } from 'node:fs';
import type { ConnectorSpec } from '@repo/connectors';
import { closeConnection, provisionStream } from '@repo/messaging';
import { connectors, sourceNames } from './registry';

async function replay(spec: ConnectorSpec<unknown>, dir: string, publish: boolean): Promise<void> {
  for await (const item of spec.read(dir).items()) {
    const { emissions } = spec.map(item);
    for (const e of emissions) {
      if (publish) {
        await e.publish();
      } else {
        process.stdout.write(
          JSON.stringify({
            event_type: e.event_type,
            subject_id: e.subject_id,
            source: e.source,
            payload: e.payload,
          }) + '\n',
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      data: { type: 'string' },
      watch: { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
    },
  });

  const cwd = process.env['INIT_CWD'] ?? process.cwd();
  const baseDir = values.data
    ? isAbsolute(values.data)
      ? values.data
      : resolve(cwd, values.data)
    : resolve(cwd, 'apps/playground/Dummyfiles');

  const selected = values.source ? [values.source] : sourceNames;
  for (const name of selected) {
    if (!connectors[name]) {
      console.error(`unknown source: ${name}. available: ${sourceNames.join(', ')}`);
      process.exit(2);
    }
  }

  const publishMode = values.publish ?? false;
  if (publishMode) await provisionStream();

  for (const name of selected) {
    const spec = connectors[name]!;
    console.error(`[runner] replay ${name} from ${baseDir}${publishMode ? ' (publish)' : ''}`);
    await replay(spec, baseDir, publishMode);
  }

  if (!values.watch) {
    if (publishMode) await closeConnection();
    return;
  }

  for (const name of selected) {
    const spec = connectors[name]!;
    let pending: NodeJS.Timeout | null = null;
    watch(baseDir, () => {
      if (pending) clearTimeout(pending);
      // Editors fire multiple events per save; coalesce. Replays are idempotent
      // via deterministic event_id + JetStream Nats-Msg-Id dedup.
      pending = setTimeout(() => {
        pending = null;
        console.error(`[runner] ${name} fixtures changed, replaying`);
        replay(spec, baseDir, publishMode).catch((err) => {
          console.error(`[runner] ${name} replay failed:`, err);
        });
      }, 100);
    });
  }

  console.error(`[runner] watching ${selected.join(', ')} (Ctrl+C to exit)`);

  const shutdown = (signal: string): void => {
    console.error(`[runner] received ${signal}, draining`);
    void (publishMode ? closeConnection() : Promise.resolve()).finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
