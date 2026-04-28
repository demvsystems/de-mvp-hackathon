import {
  createSubscriber,
  deleteConsumer,
  provisionConsumer,
  type ConsumerOptions,
  type Subscriber,
} from '@repo/messaging';

export type WorkerState = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

export interface WorkerInfo {
  name: string;
  state: WorkerState;
  consumer: string;
  lastError?: string;
}

export interface SubscriberWorker {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
}

export interface SubscriberWorkerSpec {
  load: () => Promise<SubscriberWorker>;
  requiredEnv?: readonly string[];
}

interface RuntimeEntry {
  spec: SubscriberWorkerSpec;
  module: SubscriberWorker | null;
  sub: Subscriber | null;
  state: WorkerState;
  lastError?: string;
}

export class WorkerRegistry {
  private readonly workers = new Map<string, RuntimeEntry>();

  register(name: string, spec: SubscriberWorkerSpec): void {
    if (this.workers.has(name)) throw new Error(`worker already registered: ${name}`);
    this.workers.set(name, { spec, module: null, sub: null, state: 'stopped' });
  }

  names(): string[] {
    return [...this.workers.keys()];
  }

  list(): WorkerInfo[] {
    return [...this.workers.entries()].map(([name, e]) => ({
      name,
      state: e.state,
      consumer: e.module?.consumer.durable_name ?? name,
      ...(e.lastError !== undefined && { lastError: e.lastError }),
    }));
  }

  async start(name: string): Promise<WorkerInfo> {
    const entry = this.require(name);
    if (entry.state === 'running' || entry.state === 'starting') return this.info(name);

    entry.state = 'starting';
    delete entry.lastError;
    try {
      const missing = (entry.spec.requiredEnv ?? []).filter((k) => !process.env[k]);
      if (missing.length > 0) {
        throw new Error(`missing env: ${missing.join(', ')}`);
      }
      const mod = entry.module ?? (await entry.spec.load());
      entry.module = mod;
      await provisionConsumer(mod.consumer);
      const sub = createSubscriber({ consumer: mod.consumer.durable_name });
      mod.register(sub);
      entry.sub = sub;
      entry.state = 'running';
      console.error(`[backend] starting ${name} (consumer "${mod.consumer.durable_name}")`);
      void sub.start().catch((err) => {
        entry.state = 'error';
        entry.lastError = err instanceof Error ? err.message : String(err);
        console.error(`[backend] ${name} stopped on error:`, err);
      });
    } catch (err) {
      entry.state = 'error';
      entry.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
    return this.info(name);
  }

  async stop(name: string): Promise<WorkerInfo> {
    const entry = this.require(name);
    if (entry.state === 'stopped') return this.info(name);
    entry.state = 'stopping';
    try {
      await entry.sub?.stop();
      entry.sub = null;
      entry.state = 'stopped';
    } catch (err) {
      entry.state = 'error';
      entry.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
    return this.info(name);
  }

  async reset(name: string): Promise<WorkerInfo> {
    const entry = this.require(name);
    const wasRunning = entry.state === 'running' || entry.state === 'starting';
    if (entry.sub) await this.stop(name);

    const mod = entry.module ?? (await entry.spec.load());
    entry.module = mod;
    await deleteConsumer(mod.consumer.durable_name);
    await provisionConsumer({ ...mod.consumer, deliver_policy: 'all' });
    console.error(`[backend] reset ${name} (consumer "${mod.consumer.durable_name}")`);

    if (wasRunning) await this.start(name);
    return this.info(name);
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.names().map((n) =>
        this.stop(n).catch((err) => console.error(`[backend] stop ${n}:`, err)),
      ),
    );
  }

  private info(name: string): WorkerInfo {
    return this.list().find((w) => w.name === name)!;
  }

  private require(name: string): RuntimeEntry {
    const entry = this.workers.get(name);
    if (!entry) throw new Error(`unknown worker: ${name}`);
    return entry;
  }
}
