import {
  EdgeObserved,
  publish,
  type EdgeObservedPayload,
  type MessageContext,
  type PublishAck,
  type PublishInput,
  type RecordPayload,
} from '@repo/messaging';
import type { MentionMatch } from './patterns';

/**
 * Source-Tag für alle vom Mention-Extractor emittierten Edges. Versioniert,
 * damit ein späterer LLM-Extractor (`mention-extractor:llm:v1`) parallel
 * laufen kann — UNIQUE-Constraint im Materializer ist auf
 * `(from_id, to_id, type, source)`, beide Tags ergeben getrennte Rows.
 */
export const EXTRACTOR_SOURCE = 'mention-extractor:regex:v1';
export const EXTRACTOR_VERSION = 'regex:v1';

interface MentionEvidence {
  matched_text: string;
  match_offset_start: number;
  match_offset_end: number;
  pattern_name: string;
  extractor_version: string;
}

/**
 * Pure function: baut die `PublishInput` für eine `edge.observed`-Emission.
 * Trennt sich von `emitMentionEdge`, damit Tests den Inhalt prüfen können
 * ohne NATS zu brauchen.
 */
export function buildMentionEdge(
  fromPayload: RecordPayload,
  match: MentionMatch,
  targetId: string,
  ctx: MessageContext,
): PublishInput<EdgeObservedPayload> & { evidence: MentionEvidence } {
  const subjectId = `edge:mentions:${fromPayload.id}->${targetId}`;
  const evidence: MentionEvidence = {
    matched_text: match.matchText,
    match_offset_start: match.matchStart,
    match_offset_end: match.matchEnd,
    pattern_name: match.patternName,
    extractor_version: EXTRACTOR_VERSION,
  };
  return {
    source: EXTRACTOR_SOURCE,
    occurred_at: new Date().toISOString(),
    subject_id: subjectId,
    causation_id: ctx.envelope.event_id,
    ...(ctx.envelope.correlation_id !== null
      ? { correlation_id: ctx.envelope.correlation_id }
      : {}),
    evidence,
    payload: {
      from_id: fromPayload.id,
      to_id: targetId,
      type: 'mentions',
      source: EXTRACTOR_SOURCE,
      confidence: match.confidence,
      weight: 1.0,
      valid_from: fromPayload.created_at,
      valid_to: null,
    },
  };
}

/** Convenience: baut + publisht. Wird vom Module aufgerufen. */
export async function emitMentionEdge(
  fromPayload: RecordPayload,
  match: MentionMatch,
  targetId: string,
  ctx: MessageContext,
): Promise<PublishAck> {
  return publish(EdgeObserved, buildMentionEdge(fromPayload, match, targetId, ctx));
}
