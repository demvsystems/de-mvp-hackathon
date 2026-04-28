import {
  RecordObserved,
  RecordUpdated,
  type ConsumerOptions,
  type MessageContext,
  type RecordPayload,
  type Subscriber,
} from '@repo/messaging';

// Container-Records haben keinen relevanten Body für Mention-Extraktion.
// Spec Z7: Skip ist sauberer als Body-Scan auf Channel-Topic oder Repo-Description.
const SKIP_TYPES = new Set(['channel', 'repo', 'project', 'database', 'space', 'user']);

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

async function dispatch(payload: RecordPayload, ctx: MessageContext, kind: string): Promise<void> {
  if (SKIP_TYPES.has(payload.type)) return;
  // Stub: noch keine Pattern-Logik. Folge-Schritte ergänzen findMentions(),
  // Resolver, pending-Logik und emitMentionEdge().
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
