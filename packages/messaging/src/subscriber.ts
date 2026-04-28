import {
  jetstream,
  type ConsumerMessages,
  type ConsumerNotification,
  type JsMsg,
} from '@nats-io/jetstream';
import { getConnection } from './connection';
import type { EventDefinition } from './event';
import { STREAM_NAME, CONSUMER_NAME } from './topology';

export interface MessageContext {
  readonly subject: string;
  readonly seq: number;
  readonly deliveryCount: number;
}

type Handler<T> = (payload: T, ctx: MessageContext) => Promise<void> | void;

interface HandlerEntry {
  subject: string;
  parse: (raw: unknown) => unknown;
  handle: Handler<unknown>;
}

export class Subscriber {
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly stream: string;
  private readonly consumer: string;
  private running = false;
  private current: ConsumerMessages | null = null;

  constructor(opts: { stream?: string; consumer?: string } = {}) {
    this.stream = opts.stream ?? STREAM_NAME;
    this.consumer = opts.consumer ?? CONSUMER_NAME;
  }

  on<T>(event: EventDefinition<T>, handler: Handler<T>): this {
    this.handlers.set(event.subject, {
      subject: event.subject,
      parse: (raw) => event.schema.parse(raw),
      handle: handler as Handler<unknown>,
    });
    return this;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error('subscriber already started');
    if (this.handlers.size === 0) throw new Error('no handlers registered');
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.current?.stop();
  }

  private async runLoop(): Promise<void> {
    const nc = await getConnection();
    const js = jetstream(nc);

    while (this.running && !nc.isClosed()) {
      try {
        const consumer = await js.consumers.get(this.stream, this.consumer);
        const messages = await consumer.consume();
        this.current = messages;
        void this.watchStatus(messages);

        for await (const m of messages) {
          if (!this.running) break;
          await this.dispatch(m);
        }
      } catch (err) {
        if (this.running) console.error('[messaging] consume loop error, retrying', err);
      } finally {
        this.current = null;
      }
      if (this.running) await sleep(500);
    }
  }

  private async dispatch(m: JsMsg): Promise<void> {
    const entry = this.handlers.get(m.subject);
    if (!entry) {
      console.warn(`[messaging] no handler for ${m.subject} seq=${m.seq}, term`);
      m.term();
      return;
    }

    let payload: unknown;
    try {
      payload = entry.parse(JSON.parse(m.string()));
    } catch (err) {
      console.error(`[messaging] invalid payload ${m.subject} seq=${m.seq}, term`, err);
      m.term();
      return;
    }

    try {
      await entry.handle(payload, {
        subject: m.subject,
        seq: m.seq,
        deliveryCount: m.info.deliveryCount,
      });
      m.ack();
    } catch (err) {
      console.error(`[messaging] handler failed ${m.subject} seq=${m.seq}, nak`, err);
      m.nak();
    }
  }

  private async watchStatus(messages: ConsumerMessages): Promise<void> {
    try {
      for await (const s of messages.status() as AsyncIterable<ConsumerNotification>) {
        if (s.type === 'heartbeats_missed') {
          console.warn(`[messaging] heartbeats missed (count=${s.count}), restarting`);
          await messages.stop();
          return;
        }
      }
    } catch {
      // status iterator closes when messages.stop() is called — expected
    }
  }
}

export function createSubscriber(opts?: { stream?: string; consumer?: string }): Subscriber {
  return new Subscriber(opts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
