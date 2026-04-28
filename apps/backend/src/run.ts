import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import type { ConnectorSpec } from '@repo/connectors';
import {
  closeConnection,
  createSubscriber,
  provisionConsumer,
  provisionStream,
  type ConsumerOptions,
  type Subscriber,
} from '@repo/messaging';
import { connectors, sourceNames } from './registry';

interface SubscriberWorker {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
}

interface SubscriberWorkerSpec {
  load: () => Promise<SubscriberWorker>;
  requiredEnv?: readonly string[];
}

// Lazy-loaded so a worker subset doesn't drag in unrelated env requirements
// (e.g. running `--workers connectors` shouldn't need DATABASE_URL via the
// reviewer's tool imports, or AZURE_OPENAI_* via the embedder client).
const SUBSCRIBER_WORKERS: Record<string, SubscriberWorkerSpec> = {
  embedder: {
    load: () => import('@repo/embedder').then((m) => m.embedderModule),
    requiredEnv: ['AZURE_OPENAI_API_KEY'],
  },
  materializer: {
    load: () => import('@repo/materializer').then((m) => m.materializerModule),
  },
  'mention-extractor': {
    load: () => import('@repo/mention-extractor').then((m) => m.mentionExtractorModule),
  },
  reviewer: {
    load: () => import('@repo/agent/reviewer').then((m) => m.agentReviewerModule),
    requiredEnv: ['AZURE_OPENAI_API_KEY'],
  },
  'topic-discovery': {
    load: () => import('@repo/topic-discovery').then((m) => m.topicDiscoveryModule),
  },
};

const ALL_WORKERS = ['connectors', ...Object.keys(SUBSCRIBER_WORKERS)];

async function startSubscriberWorker(name: string, mod: SubscriberWorker): Promise<Subscriber> {
  await provisionConsumer(mod.consumer);
  const sub = createSubscriber({ consumer: mod.consumer.durable_name });
  mod.register(sub);
  console.error(`[backend] starting ${name} (consumer "${mod.consumer.durable_name}")`);
  void sub.start().catch((err) => console.error(`[backend] ${name} stopped on error:`, err));
  return sub;
}

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

  const selectedWorkers = values.workers
    ? values.workers
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
    : ALL_WORKERS;
  for (const w of selectedWorkers) {
    if (!ALL_WORKERS.includes(w)) {
      console.error(`unknown worker: ${w}. available: ${ALL_WORKERS.join(', ')}`);
      process.exit(2);
    }
  }

  await provisionStream();

  const subscribers: { name: string; sub: Subscriber }[] = [];
  for (const name of selectedWorkers) {
    if (name === 'connectors') continue;
    const spec = SUBSCRIBER_WORKERS[name]!;
    const missing = (spec.requiredEnv ?? []).filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.error(`[backend] skipping ${name}: missing env ${missing.join(', ')}`);
      continue;
    }
    const mod = await spec.load();
    const sub = await startSubscriberWorker(name, mod);
    subscribers.push({ name, sub });
  }

  let connectorsHandle: { stop: () => void } | null = null;
  if (selectedWorkers.includes('connectors')) {
    const cwd = process.env['INIT_CWD'] ?? process.cwd();
    const baseDir = values.data
      ? isAbsolute(values.data)
        ? values.data
        : resolve(cwd, values.data)
      : resolve(cwd, 'apps/playground/Dummyfiles');

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

  const stayAlive = subscribers.length > 0 || (values.watch ?? false);
  if (!stayAlive) {
    await closeConnection();
    return;
  }

  if (subscribers.length > 0) {
    console.error(`[backend] running ${subscribers.length} subscriber(s); Ctrl+C to drain`);
  } else {
    console.error('[backend] watching connectors; Ctrl+C to exit');
  }

  await new Promise<void>((resolveShutdown) => {
    const shutdown = (signal: string): void => {
      console.error(`[backend] received ${signal}, draining`);
      connectorsHandle?.stop();
      Promise.all(subscribers.map((s) => s.sub.stop()))
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
