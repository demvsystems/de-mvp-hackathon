import { jetstream } from '@nats-io/jetstream';
import { getConnection } from './connection';
import { renderSubject, type EventDefinition } from './event';
import type { EventEnvelope } from './envelope';
import { contentHash, deterministicEventId } from './hash';

export interface PublishInput<T> {
  source: string;
  occurred_at: string;
  subject_id: string;
  payload: T;
  source_event_id?: string;
  evidence?: unknown;
  causation_id?: string;
  correlation_id?: string;
  content_hash?: string;
}

export interface PublishAck {
  event_id: string;
  seq: number;
  stream: string;
  duplicate: boolean;
}

export async function publish<T>(
  event: EventDefinition<T>,
  input: PublishInput<T>,
): Promise<PublishAck> {
  const validated = event.payload.parse(input.payload);

  const event_id = deterministicEventId({
    event_type: event.event_type,
    source: input.source,
    subject_id: input.subject_id,
    occurred_at: input.occurred_at,
    content_hash: input.content_hash ?? contentHash(validated),
  });

  const envelope: EventEnvelope = {
    event_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    occurred_at: input.occurred_at,
    observed_at: new Date().toISOString(),
    source: input.source,
    source_event_id: input.source_event_id ?? null,
    subject_kind: event.subject_kind,
    subject_id: input.subject_id,
    payload: validated,
    evidence: input.evidence ?? null,
    causation_id: input.causation_id ?? null,
    correlation_id: input.correlation_id ?? null,
  };

  const subject = renderSubject(event.subject_template, { source: input.source });

  const nc = await getConnection();
  const js = jetstream(nc);
  const ack = await js.publish(subject, JSON.stringify(envelope), { msgID: event_id });
  return { event_id, seq: ack.seq, stream: ack.stream, duplicate: ack.duplicate };
}
