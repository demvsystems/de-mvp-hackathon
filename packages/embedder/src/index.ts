import {
  RecordObserved,
  RecordUpdated,
  type ConsumerOptions,
  type MessageContext,
  type RecordPayload,
  type Subscriber,
} from '@repo/messaging';
import { embedRecordBodyOnly } from './embed';

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

async function dispatch(payload: RecordPayload, ctx: MessageContext, kind: string): Promise<void> {
  if (SKIP_TYPES.has(payload.type)) return;
  await embedRecordBodyOnly(payload, ctx);
  trace(ctx, kind);
}

export const embedderModule: {
  consumer: ConsumerOptions;
  register: (sub: Subscriber) => void;
} = {
  consumer: {
    durable_name: 'embedder',
    filter_subject: 'events.record.>',
    deliver_policy: 'all',
  },
  register(sub) {
    sub
      .on(RecordObserved, (p, ctx) => dispatch(p, ctx, 'record.observed'))
      .on(RecordUpdated, (p, ctx) => dispatch(p, ctx, 'record.updated'));
  },
};
