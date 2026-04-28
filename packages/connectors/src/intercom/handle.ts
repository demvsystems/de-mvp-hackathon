import { EdgeObserved, RecordObserved } from '@repo/messaging';
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

function emitConversationCascade(conv: IntercomConversation, emissions: Emission[]): void {
  const convSubjectId = conversationId(conv.id);
  const payload = {
    id: convSubjectId,
    type: 'conversation',
    source: SOURCE,
    title: conv.subject ?? null,
    body: null,
    payload: {
      state: conv.state,
      tags: conv.tags,
      contact_id: conv.contact.id,
      assignee_id: conv.assignee_id ?? null,
      part_count: conv.parts.length,
    },
    created_at: conv.created_at,
    updated_at: conv.updated_at,
  };

  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: convSubjectId,
    occurred_at: conv.created_at,
    payload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: conv.created_at,
      subject_id: convSubjectId,
      source_event_id: conv.id,
      payload,
    }),
  );

  // Conversation gehört dem Customer (initiator).
  emissions.push(
    emitEdge(
      'authored_by',
      convSubjectId,
      contactId(conv.contact.id),
      conv.created_at,
      causationId,
    ),
  );

  if (conv.assignee_id) {
    emissions.push(
      emitEdge(
        'assigned_to',
        convSubjectId,
        agentId(conv.assignee_id),
        conv.created_at,
        causationId,
      ),
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
    }),
  );

  emissions.push(emitEdge('posted_in', partSubjectId, convSubjectId, part.created_at, causationId));
  emissions.push(
    emitEdge('authored_by', partSubjectId, authorSubjectId, part.created_at, causationId),
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

function emitEdge(
  type: 'posted_in' | 'authored_by' | 'assigned_to',
  fromId: string,
  toId: string,
  validFrom: IsoDateTime,
  causationId: string,
): Emission {
  return emit(EdgeObserved, {
    source: SOURCE,
    occurred_at: validFrom,
    subject_id: makeEdgeId(type, fromId, toId),
    causation_id: causationId,
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
