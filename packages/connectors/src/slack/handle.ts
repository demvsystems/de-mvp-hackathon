import { EdgeObserved, RecordObserved, RecordTombstoned, RecordUpdated } from '@repo/messaging';
import {
  edgeSource,
  emit,
  makeEdgeId,
  predictRecordObservedId,
  type ConnectorOutput,
  type Emission,
  type IsoDateTime,
} from '../core';
import { SlackChannel, SlackParticipant, SlackSnapshot, type SlackChatMessage } from './schema';
import { DEFAULT_WORKSPACE, SOURCE, channelId, messageId, userId } from './ids';

const EDGE_SOURCE = edgeSource(SOURCE);
const WORKSPACE = DEFAULT_WORKSPACE;

/**
 * Mappt einen Slack-Snapshot auf Emissions: ein Channel-Record, je Teilnehmer
 * ein User-Record und je Nachricht (inkl. Thread-Replies) ein Message-Record
 * mit den strukturellen Edges. Die Edges einer Message tragen `causation_id`
 * auf das Record-Event derselben Message — damit ist die Provenance vom Edge
 * zurück zum auslösenden Event traversierbar (Z2).
 *
 * Annahme: Channel und User haben kein eigenes Source-Timestamp im Mock; wir
 * verwenden den frühesten Message-Timestamp als plausiblen `occurred_at`,
 * damit Materializer-LWW konsistent bleibt.
 */
export function map(item: unknown): ConnectorOutput {
  const snap = SlackSnapshot.parse(item);
  const emissions: Emission[] = [];

  const baseTs = earliestMessageDatetime(snap.content) ?? new Date().toISOString();
  const channelSubjectId = channelId(snap.channel.id, WORKSPACE);

  emissions.push(emitChannelRecord(snap.channel, channelSubjectId, baseTs));

  for (const p of snap.participants) {
    const userSubjectId = userId(p.id, WORKSPACE);
    emissions.push(emitUserRecord(p, userSubjectId, baseTs));
  }

  for (const msg of snap.content) {
    visitMessage(msg, channelSubjectId, snap.channel.id, null, null, emissions);
  }

  return { emissions };
}

/**
 * Flacht alle Thread-Reply-Texte (rekursiv) zu einer flachen Liste ab. Wird
 * verwendet, um den Body der Top-Level-Message mit dem Thread-Verlauf
 * anzureichern. Edits in Replies werden hier nicht berücksichtigt — wir
 * nehmen den aktuellen `text` jedes Replies als Snapshot-Stand.
 */
function flattenThreadTexts(messages: SlackChatMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.text) out.push(m.text);
    if (m.thread) out.push(...flattenThreadTexts(m.thread.messages));
  }
  return out;
}

function earliestMessageDatetime(messages: SlackChatMessage[]): IsoDateTime | null {
  let earliest: string | null = null;
  for (const m of messages) {
    if (earliest === null || m.datetime < earliest) earliest = m.datetime;
    if (m.thread) {
      const inner = earliestMessageDatetime(m.thread.messages);
      if (inner !== null && (earliest === null || inner < earliest)) earliest = inner;
    }
  }
  return earliest;
}

function emitChannelRecord(ch: SlackChannel, subjectId: string, occurredAt: IsoDateTime): Emission {
  const description = [ch.topic, ch.purpose].filter(Boolean).join(' — ') || null;
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: ch.id,
    payload: {
      id: subjectId,
      type: 'channel',
      source: SOURCE,
      title: ch.display_name || ch.name,
      body: description,
      payload: {
        channel_id: ch.id,
        name: ch.name,
        type: ch.type,
        topic: ch.topic ?? null,
        purpose: ch.purpose ?? null,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function emitUserRecord(p: SlackParticipant, subjectId: string, occurredAt: IsoDateTime): Emission {
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: p.id,
    payload: {
      id: subjectId,
      type: 'user',
      source: SOURCE,
      title: p.display_name || p.real_name,
      body: null,
      payload: {
        user_id: p.id,
        display_name: p.display_name,
        real_name: p.real_name,
        role_hint: p.role_hint ?? null,
        // Mock liefert kein Bot-/External-Signal — hardcoded auf false. Sobald
        // die Mocks die Felder ergänzen, hier einlesen.
        is_bot: false,
        is_external: false,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function visitMessage(
  msg: SlackChatMessage,
  channelSubjectId: string,
  rawChannelId: string,
  parentSubjectId: string | null,
  topLevelSubjectId: string | null,
  emissions: Emission[],
): void {
  const msgSubjectId = messageId(rawChannelId, msg.slack_ts, WORKSPACE);
  const authorSubjectId = userId(msg.author.id, WORKSPACE);
  // Top-Level-Message korreliert auf sich selbst, Replies erben den Anker
  // ihres Threads. So tragen alle Events einer Konversation denselben Schlüssel.
  const correlationId = topLevelSubjectId ?? msgSubjectId;

  // Bei Edits ist der initiale `body` der Text VOR dem ersten Edit. Ohne Edits
  // ist `text` der einzige bekannte Stand.
  const hasEdits = msg.edits !== undefined && msg.edits.length > 0;
  const originalBody = hasEdits ? msg.edits![0]!.previous_text : msg.text;

  // Top-Level-Messages tragen den ganzen Thread im Body, damit Embedder/Topic-
  // Discovery den Konversationsverlauf sehen. Replies bleiben eigene Records mit
  // ihrem eigenen body — das ist nur eine Anreicherung des Cluster-Ankers.
  const isTopLevel = parentSubjectId === null;
  const enrichedBody =
    isTopLevel && msg.thread
      ? [originalBody, ...flattenThreadTexts(msg.thread.messages)].filter(Boolean).join('\n\n')
      : originalBody;

  const observedPayload = {
    id: msgSubjectId,
    type: 'message',
    source: SOURCE,
    title: null,
    body: enrichedBody,
    payload: {
      slack_id: msg.id,
      slack_ts: msg.slack_ts,
      channel_id: rawChannelId,
      author_id: msg.author.id,
      is_thread_reply: msg.type === 'thread_reply',
      mentions: msg.mentions,
    },
    created_at: msg.datetime,
    updated_at: msg.datetime,
  };

  const observedCausation = predictRecordObservedId({
    source: SOURCE,
    subject_id: msgSubjectId,
    occurred_at: msg.datetime,
    payload: observedPayload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: msg.datetime,
      subject_id: msgSubjectId,
      source_event_id: msg.slack_ts,
      payload: observedPayload,
      correlation_id: correlationId,
    }),
  );

  emissions.push(
    emit(EdgeObserved, {
      source: SOURCE,
      occurred_at: msg.datetime,
      subject_id: makeEdgeId('authored_by', msgSubjectId, authorSubjectId),
      causation_id: observedCausation,
      correlation_id: correlationId,
      payload: {
        from_id: msgSubjectId,
        to_id: authorSubjectId,
        type: 'authored_by',
        source: EDGE_SOURCE,
        confidence: 1.0,
        weight: 1.0,
        valid_from: msg.datetime,
        valid_to: null,
      },
    }),
  );

  emissions.push(
    emit(EdgeObserved, {
      source: SOURCE,
      occurred_at: msg.datetime,
      subject_id: makeEdgeId('posted_in', msgSubjectId, channelSubjectId),
      causation_id: observedCausation,
      correlation_id: correlationId,
      payload: {
        from_id: msgSubjectId,
        to_id: channelSubjectId,
        type: 'posted_in',
        source: EDGE_SOURCE,
        confidence: 1.0,
        weight: 1.0,
        valid_from: msg.datetime,
        valid_to: null,
      },
    }),
  );

  if (parentSubjectId !== null) {
    emissions.push(
      emit(EdgeObserved, {
        source: SOURCE,
        occurred_at: msg.datetime,
        subject_id: makeEdgeId('replies_to', msgSubjectId, parentSubjectId),
        causation_id: observedCausation,
        correlation_id: correlationId,
        payload: {
          from_id: msgSubjectId,
          to_id: parentSubjectId,
          type: 'replies_to',
          source: EDGE_SOURCE,
          confidence: 1.0,
          weight: 1.0,
          valid_from: msg.datetime,
          valid_to: null,
        },
      }),
    );
  }

  // Edits zu einer Kette von record.updated abrollen. body[i] = previous_text
  // des nächsten Edits (oder der aktuelle `text` beim letzten). Top-Level-
  // Messages tragen den Thread im Body — siehe enrichedBody oben.
  if (hasEdits) {
    const edits = msg.edits!;
    const threadSuffix =
      isTopLevel && msg.thread ? flattenThreadTexts(msg.thread.messages).join('\n\n') : '';
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;
      const isLast = i === edits.length - 1;
      const newText = isLast ? msg.text : edits[i + 1]!.previous_text;
      const newBody = threadSuffix ? [newText, threadSuffix].filter(Boolean).join('\n\n') : newText;
      emissions.push(
        emit(RecordUpdated, {
          source: SOURCE,
          occurred_at: edit.edited_at,
          subject_id: msgSubjectId,
          source_event_id: `${msg.slack_ts}#edit#${i}`,
          causation_id: observedCausation,
          correlation_id: correlationId,
          payload: {
            ...observedPayload,
            body: newBody,
            updated_at: edit.edited_at,
          },
        }),
      );
    }
  }

  if (msg.deleted_at !== undefined) {
    emissions.push(
      emit(RecordTombstoned, {
        source: SOURCE,
        occurred_at: msg.deleted_at,
        subject_id: msgSubjectId,
        source_event_id: `${msg.slack_ts}#tombstone`,
        causation_id: observedCausation,
        correlation_id: correlationId,
        payload: { id: msgSubjectId },
      }),
    );
  }

  // User-Tags aus `msg.mentions[]` werden bewusst NICHT als Edge emittiert —
  // das ist Aufgabe des Mention-Extractors (Z7) bzw. der "Referenzen Extrahiert"-
  // Box am EventStream. Die Liste bleibt im Record-Payload sichtbar, sodass ein
  // späterer Extractor-Lauf User-Tag-Patterns ergänzen kann, ohne dass der
  // Connector Information vorenthält.
  if (msg.thread) {
    for (const reply of msg.thread.messages) {
      visitMessage(reply, channelSubjectId, rawChannelId, msgSubjectId, correlationId, emissions);
    }
  }
}
