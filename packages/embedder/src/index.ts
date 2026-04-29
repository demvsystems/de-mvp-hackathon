import {
  EdgeObserved,
  RecordObserved,
  RecordUpdated,
  type ConsumerOptions,
  type EdgeObservedPayload,
  type MessageContext,
  type RecordPayload,
  type Subscriber,
} from '@repo/messaging';
import { embedRecordBodyOnly, embedRecordWithNeighbors } from './embed';
import { fetchRecord, recordRowToPayload } from './neighbors';

const SKIP_TYPES = new Set(['channel', 'repo', 'project', 'database', 'space', 'user']);

function trace(ctx: MessageContext, kind: string): void {
  console.log(
    JSON.stringify({
      msg: 'embedder applied',
      kind,
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      seq: ctx.seq,
    }),
  );
}

function logFailure(scope: string, ctx: MessageContext, err: unknown): void {
  console.error(
    JSON.stringify({
      msg: 'embedder error',
      scope,
      event_id: ctx.envelope.event_id,
      subject_id: ctx.envelope.subject_id,
      err: err instanceof Error ? err.message : String(err),
    }),
  );
}

async function dispatchRecord(
  payload: RecordPayload,
  ctx: MessageContext,
  kind: string,
): Promise<void> {
  if (SKIP_TYPES.has(payload.type)) return;
  // Body-only must succeed (or NAK) — it's the canonical embedding everyone
  // depends on. With-neighbors is best-effort: a DB read failure or stale
  // neighbor must not poison the body-only delivery.
  await embedRecordBodyOnly(payload, ctx);
  try {
    await embedRecordWithNeighbors(payload, ctx);
  } catch (err) {
    logFailure('with-neighbors', ctx, err);
  }
  trace(ctx, kind);
}

async function dispatchEdge(payload: EdgeObservedPayload, ctx: MessageContext): Promise<void> {
  if (payload.valid_to !== null) return; // retraction — nothing to enrich
  const target =
    payload.type === 'replies_to' || payload.type === 'references'
      ? payload.from_id
      : payload.type === 'commented_on'
        ? payload.to_id
        : null;
  if (!target) return;

  let row;
  try {
    row = await fetchRecord(target);
  } catch (err) {
    logFailure('edge.fetch', ctx, err);
    return;
  }
  if (!row || SKIP_TYPES.has(row.type)) return;

  try {
    await embedRecordWithNeighbors(recordRowToPayload(row), ctx);
    trace(ctx, `edge.observed:${payload.type}`);
  } catch (err) {
    logFailure('edge.with-neighbors', ctx, err);
  }
}

export const embedderModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'embedder',
    // Broadened to receive edge.observed too. Subscriber silently acks events
    // without a registered handler, so unrelated traffic is cheap.
    filter_subject: 'events.>',
    deliver_policy: 'all',
  },
  register(sub) {
    sub
      .on(RecordObserved, (p, ctx) => dispatchRecord(p, ctx, 'record.observed'))
      .on(RecordUpdated, (p, ctx) => dispatchRecord(p, ctx, 'record.updated'))
      .on(EdgeObserved, (p, ctx) => dispatchEdge(p, ctx));
  },
};
