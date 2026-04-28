import {
  EdgeObserved,
  RecordDeleted,
  RecordObserved,
  RecordTombstoned,
  RecordUpdated,
  type EventDefinition,
} from '@repo/messaging';
import { z } from 'zod';
import type { Emission } from './types';

/**
 * Map von `event_type` auf die zugehörige `EventDefinition` aus
 * `@repo/messaging`. Vertragstests prüfen, dass jede Emission gegen das
 * passende Payload-Schema validiert. Wenn der Eventsystem-Kollege ein neues
 * Event-Type ergänzt, kommt hier ein Eintrag dazu.
 *
 * Cast nach `EventDefinition<unknown>`: notwendig, weil EventDefinition in
 * TItem invariant ist (ZodType ist es). Zur Laufzeit funktioniert safeParse
 * auf `unknown` einwandfrei, weil Zod runtime-typed validiert.
 */
const EVENT_DEFS: Record<string, EventDefinition<unknown>> = {
  'record.observed': RecordObserved as unknown as EventDefinition<unknown>,
  'record.updated': RecordUpdated as unknown as EventDefinition<unknown>,
  'record.deleted': RecordDeleted as unknown as EventDefinition<unknown>,
  'record.tombstoned': RecordTombstoned as unknown as EventDefinition<unknown>,
  'edge.observed': EdgeObserved as unknown as EventDefinition<unknown>,
};

/**
 * Wirft, wenn eine Emission ein unbekanntes `event_type` hat oder ihr Payload
 * das zugehörige `EventDefinition.payload`-Schema verletzt. Der Fehlertext
 * zeigt, welche Emission an welcher Stelle fehlschlägt — gedacht für
 * Vitest-Tests, die genau diese Bruchstelle aufdecken sollen.
 */
export function assertContractValid(emissions: Emission[]): void {
  for (const e of emissions) {
    const def = EVENT_DEFS[e.event_type];
    if (!def) {
      throw new Error(
        `Vertragsfehler: kein EventDefinition für event_type "${e.event_type}" (subject_id ${e.subject_id})`,
      );
    }
    const result = def.payload.safeParse(e.payload);
    if (!result.success) {
      throw new Error(
        `Vertragsfehler: ${e.subject_id} (${e.event_type}) verletzt Payload-Schema:\n${z.prettifyError(result.error)}`,
      );
    }
  }
}

/**
 * Reduziert eine Emission auf die Felder, die einen deterministischen
 * Vergleich erlauben — bewusst ohne `publish()`-Closure und ohne Felder,
 * die der Publisher hinzufügt (`event_id`, `observed_at`).
 */
export function serializeEmission(e: Emission): {
  event_type: string;
  source: string;
  subject_id: string;
  causation_id: string | null;
  correlation_id: string | null;
  payload: unknown;
} {
  return {
    event_type: e.event_type,
    source: e.source,
    subject_id: e.subject_id,
    causation_id: e.causation_id,
    correlation_id: e.correlation_id,
    payload: e.payload,
  };
}
