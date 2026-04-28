import {
  RecordObserved,
  RecordUpdated,
  type ConsumerOptions,
  type MessageContext,
  type RecordPayload,
  type Subscriber,
} from '@repo/messaging';
import { PendingMentions } from './pending';
import { defaultPublishFn, processNewJiraIssue, processRecord, type PublishFn } from './processor';
import type { ResolverDeps } from './resolver';

function trace(ctx: MessageContext, kind: string): void {
  console.log(
    JSON.stringify({
      msg: 'mention-extractor applied',
      kind,
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      seq: ctx.seq,
    }),
  );
}

/**
 * Lazy-loaded Production-Deps. Verzögert den `@repo/db`-Import (und damit
 * den DATABASE_URL-Check) bis zum ersten dispatch — sonst würde der
 * Modul-Import bereits crashen, wenn DATABASE_URL fehlt. Backend skipped
 * den Worker via requiredEnv, aber Tests sollen das Modul ohne DB laden
 * können.
 */
let lazyDeps: ResolverDeps | null = null;
async function getDeps(): Promise<ResolverDeps> {
  if (!lazyDeps) {
    const { createDefaultDeps } = await import('./defaultDeps');
    lazyDeps = createDefaultDeps();
  }
  return lazyDeps;
}

const pending = new PendingMentions();

async function dispatch(
  payload: RecordPayload,
  ctx: MessageContext,
  kind: string,
  publishFn: PublishFn = defaultPublishFn,
  deps?: ResolverDeps,
): Promise<void> {
  const resolverDeps = deps ?? (await getDeps());
  await processRecord(payload, ctx, resolverDeps, pending, publishFn);
  await processNewJiraIssue(payload, ctx, pending, publishFn);
  trace(ctx, kind);
}

export const mentionExtractorModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'mention-extractor',
    filter_subject: 'events.record.>',
    deliver_policy: 'all',
  },
  register(sub) {
    sub
      .on(RecordObserved, (p, ctx) => dispatch(p, ctx, 'record.observed'))
      .on(RecordUpdated, (p, ctx) => dispatch(p, ctx, 'record.updated'));
  },
};

// Re-exports für Tests und integrationsbezogene Nutzung.
export { processRecord, processNewJiraIssue } from './processor';
export { PendingMentions } from './pending';
export type { ResolverDeps } from './resolver';
