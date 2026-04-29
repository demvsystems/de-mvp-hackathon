import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import type { ConnectorSpec } from '@repo/connectors';
import { closeConnection, consumerInfo, provisionStream } from '@repo/messaging';
import { connectors, sourceNames } from './registry';
import { WorkerRegistry, type SubscriberWorkerSpec, type WorkerInfo } from './workers';
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
  reviewer: {
    load: () => import('@repo/agent/reviewer').then((m) => m.agentReviewerModule),
    requiredEnv: ['AZURE_OPENAI_API_KEY'],
  },
  executor: {
    load: () => import('@repo/agent/executor').then((m) => m.agentExecutorModule),
    requiredEnv: ['AZURE_OPENAI_API_KEY'],
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

// "Caught up" can't be expressed as a single stream-seq target: filtered
// consumers (e.g. mention-extractor on `events.record.>`) won't see the last
// connector publishes, and downstream workers consume messages cascade-
// published *by* upstream workers at higher seqs than the connectors ever
// reached. Instead, wait for every worker to report no pending matching
// messages and no in-flight acks, and require that idle state to hold for a
// short settle window so A→B→C cascades have a chance to surface.
async function waitForQuiescence(
  workers: WorkerInfo[],
  opts: { timeoutMs: number; pollMs: number; settleMs: number },
): Promise<void> {
  if (workers.length === 0) return;
  const deadline = Date.now() + opts.timeoutMs;
  let idleSince = 0;
  while (Date.now() < deadline) {
    const states = await Promise.all(
      workers.map(async (w) => {
        const info = await consumerInfo(w.consumer);
        return {
          name: w.name,
          pending: info?.num_pending ?? 0,
          inflight: info?.num_ack_pending ?? 0,
        };
      }),
    );
    const idle = states.every((s) => s.pending === 0 && s.inflight === 0);
    if (idle) {
      if (idleSince === 0) idleSince = Date.now();
      if (Date.now() - idleSince >= opts.settleMs) return;
    } else {
      idleSince = 0;
      const busy = states
        .filter((s) => s.pending > 0 || s.inflight > 0)
        .map((s) => `${s.name}(pending=${s.pending},inflight=${s.inflight})`)
        .join(', ');
      console.error(`[backend] hydrate: waiting on ${busy}`);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
  throw new Error(`hydrate: timed out waiting for workers to quiesce`);
}

async function main(): Promise<void> {
  // `pnpm run x -- --flag` forwards a literal `--` into argv; parseArgs would
  // then bucket every following flag into positionals. Strip it so flags work
  // regardless of how the caller invokes us.
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({
    args: argv,
    options: {
      workers: { type: 'string' },
      source: { type: 'string' },
      data: { type: 'string' },
      watch: { type: 'boolean', default: false },
      'hydrate-and-exit': { type: 'boolean', default: false },
      'hydrate-timeout-ms': { type: 'string' },
    },
    allowPositionals: true,
  });

  const hydrateAndExit = values['hydrate-and-exit'] ?? false;
  const hydrateTimeoutMs = Number(values['hydrate-timeout-ms'] ?? 60_000);

  // Bare `pnpm backend` defaults to everything except embedder (Azure cost),
  // topic-discovery (replaced by hand-seeded gold-standard topics — see
  // scripts/preseed-expected-topics.ts), and reviewer (started manually from
  // the admin dashboard so it's obvious when it's processing / pausable).
  // The recommended entrypoints are `pnpm dev|start|start:demo|start:full`,
  // which pass an explicit worker list via $BACKEND_WORKERS. The CLI
  // `--workers` flag still wins so single-package overrides keep working.
  // Pass `--workers ''` (or `BACKEND_WORKERS=`) to start nothing.
  const AUTOSTART_EXCLUDE = new Set(['embedder', 'topic-discovery', 'reviewer', 'executor']);
  const workersSource =
    values.workers !== undefined ? values.workers : process.env['BACKEND_WORKERS'];
  const autoStart =
    workersSource !== undefined
      ? workersSource
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
  const controlServer = hydrateAndExit ? null : startControlServer(registry, controlPort);

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
      watchMode: hydrateAndExit ? false : (values.watch ?? false),
    });
  }

  if (hydrateAndExit) {
    const runningWorkers = registry.list().filter((w) => w.state === 'running');
    console.error(
      `[backend] hydrate: waiting for ${runningWorkers.map((w) => w.name).join(', ')} to quiesce`,
    );
    try {
      await waitForQuiescence(runningWorkers, {
        timeoutMs: hydrateTimeoutMs,
        pollMs: 250,
        settleMs: 1_000,
      });
      console.error('[backend] hydrate: drained, exiting');
    } catch (err) {
      console.error(`[backend] hydrate failed: ${err instanceof Error ? err.message : err}`);
      await registry.stopAll().catch(() => undefined);
      await closeConnection().catch(() => undefined);
      process.exit(1);
    }
    connectorsHandle?.stop();
    await registry.stopAll().catch((err) => console.error('[backend] stop error:', err));
    await closeConnection().catch(() => undefined);
    // Subscribers' consume loops can leave NATS handles open even after stop()
    // (the iterator's poll/sleep timers re-arm one cycle past the stop signal).
    // We're done with this process — exit explicitly so the demo wrapper script
    // moves on to Phase 2 instead of hanging on a few stragglers.
    process.exit(0);
  }

  console.error(
    `[backend] running ${registry.list().filter((w) => w.state === 'running').length} subscriber(s); Ctrl+C to drain`,
  );

  await new Promise<void>((resolveShutdown) => {
    const shutdown = (signal: string): void => {
      console.error(`[backend] received ${signal}, draining`);
      connectorsHandle?.stop();
      controlServer?.close();
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
