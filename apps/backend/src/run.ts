import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import type { ConnectorSpec } from '@repo/connectors';
import { closeConnection, provisionStream } from '@repo/messaging';
import { connectors, sourceNames } from './registry';
import { WorkerRegistry, type SubscriberWorkerSpec } from './workers';
import { startControlServer } from './control-server';

// Lazy-loaded so a worker subset doesn't drag in unrelated env requirements
// (e.g. running `--workers connectors` shouldn't need DATABASE_URL via the
// reviewer's tool imports, or AZURE_OPENAI_* via the embedder client).
const SUBSCRIBER_WORKERS: Record<string, SubscriberWorkerSpec> = {
  embedder: {
    load: () => import('@repo/embedder').then((m) => m.embedderModule),
    requiredEnv: ['AZURE_OPENAI_API_KEY'],
  },
  'mention-extractor': {
    load: () => import('@repo/mention-extractor').then((m) => m.mentionExtractorModule),
    requiredEnv: ['DATABASE_URL'],
  },
  'topic-discovery': {
    load: () => import('@repo/topic-discovery').then((m) => m.topicDiscoveryModule),
  },
};

const ALL_WORKERS = ['connectors', ...Object.keys(SUBSCRIBER_WORKERS)];

async function replay(spec: ConnectorSpec<unknown>, dir: string): Promise<void> {
  for await (const item of spec.read(dir).items()) {
    const { emissions } = spec.map(item);
    for (const e of emissions) await e.publish();
  }
}

async function runConnectors(opts: {
  selectedSources: string[];
  baseDir: string;
  watchMode: boolean;
}): Promise<{ stop: () => void }> {
  for (const name of opts.selectedSources) {
    const spec = connectors[name]!;
    console.error(`[backend] replay ${name} from ${opts.baseDir}`);
    await replay(spec, opts.baseDir);
  }
  if (!opts.watchMode) return { stop: () => undefined };

  const watchers: FSWatcher[] = [];
  for (const name of opts.selectedSources) {
    const spec = connectors[name]!;
    let pending: NodeJS.Timeout | null = null;
    // Editors fire multiple events per save; coalesce. Replays are idempotent
    // via deterministic event_id + JetStream Nats-Msg-Id dedup.
    const w = watch(opts.baseDir, () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        console.error(`[backend] ${name} fixtures changed, replaying`);
        replay(spec, opts.baseDir).catch((err) => {
          console.error(`[backend] ${name} replay failed:`, err);
        });
      }, 100);
    });
    watchers.push(w);
  }
  return {
    stop: () => {
      for (const w of watchers) w.close();
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workers: { type: 'string' },
      source: { type: 'string' },
      data: { type: 'string' },
      watch: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  // Default: everything except embedder (Azure cost), topic-discovery
  // (replaced by hand-seeded gold-standard topics — see
  // scripts/preseed-expected-topics.ts), and reviewer (started manually from
  // the admin dashboard so it's obvious when it's processing / pausable).
  // Pass `--workers a,b` to override; pass `--workers ''` to start nothing.
  const AUTOSTART_EXCLUDE = new Set(['embedder', 'topic-discovery', 'reviewer']);
  const autoStart =
    values.workers !== undefined
      ? values.workers
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean)
      : ALL_WORKERS.filter((w) => !AUTOSTART_EXCLUDE.has(w));
  for (const w of autoStart) {
    if (!ALL_WORKERS.includes(w)) {
      console.error(`unknown worker: ${w}. available: ${ALL_WORKERS.join(', ')}`);
      process.exit(2);
    }
  }

  await provisionStream();

  const registry = new WorkerRegistry();
  for (const [name, spec] of Object.entries(SUBSCRIBER_WORKERS)) {
    registry.register(name, spec);
  }

  for (const name of autoStart) {
    if (name === 'connectors') continue;
    try {
      await registry.start(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backend] skipping ${name}: ${msg}`);
    }
  }

  const controlPort = Number(process.env['BACKEND_CONTROL_PORT'] ?? 3100);
  const controlServer = startControlServer(registry, controlPort);

  let connectorsHandle: { stop: () => void } | null = null;
  if (autoStart.includes('connectors')) {
    const cwd = process.env['INIT_CWD'] ?? process.cwd();
    const baseDir = values.data
      ? isAbsolute(values.data)
        ? values.data
        : resolve(cwd, values.data)
      : resolve(cwd, 'fixtures');

    const selectedSources = values.source ? [values.source] : sourceNames;
    for (const s of selectedSources) {
      if (!connectors[s]) {
        console.error(`unknown source: ${s}. available: ${sourceNames.join(', ')}`);
        process.exit(2);
      }
    }
    connectorsHandle = await runConnectors({
      selectedSources,
      baseDir,
      watchMode: values.watch ?? false,
    });
  }

  console.error(
    `[backend] running ${registry.list().filter((w) => w.state === 'running').length} subscriber(s); Ctrl+C to drain`,
  );

  await new Promise<void>((resolveShutdown) => {
    const shutdown = (signal: string): void => {
      console.error(`[backend] received ${signal}, draining`);
      connectorsHandle?.stop();
      controlServer.close();
      registry
        .stopAll()
        .catch((err) => console.error('[backend] stop error:', err))
        .finally(() => closeConnection().finally(() => resolveShutdown()));
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
