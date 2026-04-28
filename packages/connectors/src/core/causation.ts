import { contentHash, deterministicEventId } from '@repo/messaging';
import type { IsoDateTime } from './types';

/**
 * Berechnet vorab die deterministische `event_id` eines Events. Wird im
 * Connector genutzt, um auf strukturellen Edges einen `causation_id` setzen
 * zu können, der auf das ausgelöste Record-Event zeigt — bevor dieses Record-
 * Event tatsächlich publiziert wurde. Funktioniert, weil sowohl unser Aufruf
 * als auch `messaging.publish()` denselben Algorithmus (`deterministicEventId`
 * + canonicalized `contentHash`) auf identische Eingaben anwenden.
 */
export function predictEventId(args: {
  event_type: string;
  source: string;
  subject_id: string;
  occurred_at: IsoDateTime;
  payload: unknown;
}): string {
  return deterministicEventId({
    event_type: args.event_type,
    source: args.source,
    subject_id: args.subject_id,
    occurred_at: args.occurred_at,
    content_hash: contentHash(args.payload),
  });
}

/** Convenience-Wrapper für den häufigsten Fall: ein `record.observed`-Event. */
export function predictRecordObservedId(args: {
  source: string;
  subject_id: string;
  occurred_at: IsoDateTime;
  payload: unknown;
}): string {
  return predictEventId({ event_type: 'record.observed', ...args });
}
