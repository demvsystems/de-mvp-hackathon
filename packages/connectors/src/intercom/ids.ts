import { makeRecordId } from '../core';

export const SOURCE = 'intercom';

export function conversationId(id: string): string {
  return makeRecordId(SOURCE, 'conversation', id);
}

export function contactId(id: string): string {
  return makeRecordId(SOURCE, 'contact', id);
}

export function agentId(id: string): string {
  return makeRecordId(SOURCE, 'agent', id);
}

export function partId(conversation: string, part: string): string {
  return makeRecordId(SOURCE, 'part', conversation, part);
}
