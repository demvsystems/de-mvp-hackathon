import { EdgeObserved, RecordDeleted, RecordObserved, RecordUpdated } from '@repo/messaging';
import {
  edgeSource,
  emit,
  makeEdgeId,
  predictRecordObservedId,
  type ConnectorOutput,
  type Emission,
  type IsoDateTime,
} from '../core';
import {
  IntercomSnapshot,
  type IntercomActor,
  type IntercomAgent,
  type IntercomContact,
  type IntercomConversation,
  type IntercomConversationPart,
} from './schema';
import { SOURCE, agentId, contactId, conversationId, partId } from './ids';

const EDGE_SOURCE = edgeSource(SOURCE);

/**
 * Skelett-Mapper gegen plausible Intercom-API-Form. Sobald echte Mocks da
 * sind, gleichen wir ab — die Edge-Logik (Conversation als Container, Parts
 * als Messages) ist konsistent zu Slack. Edges einer Conversation/eines Parts
 * tragen `causation_id` auf das jeweilige Record-Event.
 */
export function map(item: unknown): ConnectorOutput {
  const snap = IntercomSnapshot.parse(item);
  const emissions: Emission[] = [];
  const now = new Date().toISOString();

  for (const c of snap.contacts) {
    emissions.push(emitContact(c, now));
  }
  for (const a of snap.agents) {
    emissions.push(emitAgent(a, now));
  }
  for (const conv of snap.conversations) {
    emitConversationCascade(conv, emissions);
  }

  return { emissions };
}

/** Mutable Felder einer Conversation, die per `updates[].previous`
 *  rekonstruierbar sind. Andere Felder (id, contact, parts, created_at) gelten
 *  als identitätsstiftend bzw. ändern sich nicht in der Demo. */
interface ConversationStateSlice {
  state: string;
  assignee_id: string | null;
  tags: string[];
  subject: string | null;
}

function emitConversationCascade(conv: IntercomConversation, emissions: Emission[]): void {
  const convSubjectId = conversationId(conv.id);
  const updates = conv.updates ?? [];

  // Conversation-Body = Parts-Bodies konkateniert. Parts werden zusätzlich als
  // eigene Records emittiert (siehe emitPartCascade unten); für die Conversation
  // als Cluster-Anker brauchen Embedder/Topic-Discovery den vollständigen
  // Konversationskontext, sonst sieht das Embedding nur den Subject.
  const conversationBody =
    conv.parts
      .map((p) => p.body)
      .filter((b): b is string => b !== null && b.length > 0)
      .join('\n\n') || null;

  const stateAt = (untilIdx: number): ConversationStateSlice => {
    let state: ConversationStateSlice = {
      state: conv.state,
      assignee_id: conv.assignee_id ?? null,
      tags: conv.tags,
      subject: conv.subject ?? null,
    };
    for (let j = updates.length - 1; j > untilIdx; j--) {
      const prev = updates[j]!.previous;
      // assignee_id und subject können explizit `null` im previous sein (war
      // vorher nicht zugewiesen). Daher `!== undefined` statt `??`.
      state = {
        state: prev.state ?? state.state,
        assignee_id: prev.assignee_id !== undefined ? prev.assignee_id : state.assignee_id,
        tags: prev.tags ?? state.tags,
        subject: prev.subject !== undefined ? prev.subject : state.subject,
      };
    }
    return state;
  };

  const buildPayload = (
    s: ConversationStateSlice,
    updatedAt: string,
  ): {
    id: string;
    type: string;
    source: string;
    title: string | null;
    body: string | null;
    payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  } => ({
    id: convSubjectId,
    type: 'conversation',
    source: SOURCE,
    title: s.subject,
    body: conversationBody,
    payload: {
      state: s.state,
      tags: s.tags,
      contact_id: conv.contact.id,
      assignee_id: s.assignee_id,
      part_count: conv.parts.length,
    },
    created_at: conv.created_at,
    updated_at: updatedAt,
  });

  const observedPayload = buildPayload(stateAt(-1), conv.created_at);
  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: convSubjectId,
    occurred_at: conv.created_at,
    payload: observedPayload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: conv.created_at,
      subject_id: convSubjectId,
      source_event_id: conv.id,
      payload: observedPayload,
      correlation_id: convSubjectId,
    }),
  );

  // Conversation gehört dem Customer (initiator). Edge auf Original-Assignee,
  // falls vorhanden — Re-Assignments sehen wir über record.updated im Payload.
  emissions.push(
    emitConversationEdge(
      'authored_by',
      convSubjectId,
      contactId(conv.contact.id),
      conv.created_at,
      causationId,
      convSubjectId,
    ),
  );

  const originalAssignee = stateAt(-1).assignee_id;
  if (originalAssignee !== null) {
    emissions.push(
      emitConversationEdge(
        'assigned_to',
        convSubjectId,
        agentId(originalAssignee),
        conv.created_at,
        causationId,
        convSubjectId,
      ),
    );
  }

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i]!;
    emissions.push(
      emit(RecordUpdated, {
        source: SOURCE,
        occurred_at: update.at,
        subject_id: convSubjectId,
        source_event_id: `${conv.id}#update#${i}`,
        causation_id: causationId,
        correlation_id: convSubjectId,
        payload: buildPayload(stateAt(i), update.at),
      }),
    );
  }

  if (conv.deleted_at !== undefined) {
    emissions.push(
      emit(RecordDeleted, {
        source: SOURCE,
        occurred_at: conv.deleted_at,
        subject_id: convSubjectId,
        source_event_id: `${conv.id}#delete`,
        causation_id: causationId,
        correlation_id: convSubjectId,
        payload: { id: convSubjectId },
      }),
    );
  }

  for (const part of conv.parts) {
    emitPartCascade(part, conv.id, convSubjectId, emissions);
  }
}

function emitPartCascade(
  part: IntercomConversationPart,
  conversationRawId: string,
  convSubjectId: string,
  emissions: Emission[],
): void {
  const partSubjectId = partId(conversationRawId, part.id);
  const authorSubjectId = actorSubjectId(part.author);
  const payload = {
    id: partSubjectId,
    type: 'message',
    source: SOURCE,
    title: null,
    body: part.body,
    payload: {
      part_type: part.part_type,
      conversation_id: conversationRawId,
      author_type: part.author.type,
      author_id: part.author.id,
    },
    created_at: part.created_at,
    updated_at: part.created_at,
  };

  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: partSubjectId,
    occurred_at: part.created_at,
    payload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: part.created_at,
      subject_id: partSubjectId,
      source_event_id: part.id,
      payload,
      correlation_id: convSubjectId,
    }),
  );

  emissions.push(
    emitConversationEdge(
      'posted_in',
      partSubjectId,
      convSubjectId,
      part.created_at,
      causationId,
      convSubjectId,
    ),
  );
  emissions.push(
    emitConversationEdge(
      'authored_by',
      partSubjectId,
      authorSubjectId,
      part.created_at,
      causationId,
      convSubjectId,
    ),
  );
}

function emitContact(c: IntercomContact, occurredAt: IsoDateTime): Emission {
  const subjectId = contactId(c.id);
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: c.id,
    payload: {
      id: subjectId,
      type: 'contact',
      source: SOURCE,
      title: c.name ?? c.email ?? c.id,
      body: null,
      payload: {
        intercom_id: c.id,
        name: c.name ?? null,
        email: c.email ?? null,
        external_id: c.external_id ?? null,
        is_external: true,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function emitAgent(a: IntercomAgent, occurredAt: IsoDateTime): Emission {
  const subjectId = agentId(a.id);
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: a.id,
    payload: {
      id: subjectId,
      type: 'agent',
      source: SOURCE,
      title: a.name,
      body: null,
      payload: {
        intercom_id: a.id,
        name: a.name,
        email: a.email ?? null,
        is_internal: true,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function actorSubjectId(actor: IntercomActor): string {
  return actor.type === 'admin' ? agentId(actor.id) : contactId(actor.id);
}

/** Edge-Helper für die Conversation-Cascade — trägt correlation_id auf das
 *  Conversation-Subject. */
function emitConversationEdge(
  type: 'posted_in' | 'authored_by' | 'assigned_to',
  fromId: string,
  toId: string,
  validFrom: IsoDateTime,
  causationId: string,
  correlationId: string,
): Emission {
  return emit(EdgeObserved, {
    source: SOURCE,
    occurred_at: validFrom,
    subject_id: makeEdgeId(type, fromId, toId),
    causation_id: causationId,
    correlation_id: correlationId,
    payload: {
      from_id: fromId,
      to_id: toId,
      type,
      source: EDGE_SOURCE,
      confidence: 1.0,
      weight: 1.0,
      valid_from: validFrom,
      valid_to: null,
    },
  });
}
