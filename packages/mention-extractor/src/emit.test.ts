import { describe, expect, it } from 'vitest';
import type { MessageContext, RecordPayload } from '@repo/messaging';
import { buildMentionEdge, EXTRACTOR_SOURCE } from './emit';
import type { MentionMatch } from './patterns';

function fakePayload(overrides: Partial<RecordPayload> = {}): RecordPayload {
  return {
    id: 'slack:msg:hackathon/C1/123.456',
    type: 'message',
    source: 'slack',
    title: null,
    body: 'Bitte zu DEMV-4127 gucken.',
    payload: {},
    created_at: '2026-04-15T10:00:00.000Z',
    updated_at: '2026-04-15T10:00:00.000Z',
    ...overrides,
  };
}

function fakeCtx(overrides: Partial<MessageContext['envelope']> = {}): MessageContext {
  return {
    envelope: {
      event_id: 'evt_abc',
      event_type: 'record.observed',
      schema_version: 1,
      occurred_at: '2026-04-15T10:00:00.000Z',
      observed_at: '2026-04-15T10:00:00.500Z',
      source: 'slack',
      source_event_id: '123.456',
      subject_kind: 'record',
      subject_id: 'slack:msg:hackathon/C1/123.456',
      payload: {},
      evidence: null,
      causation_id: null,
      correlation_id: 'slack:msg:hackathon/C1/123.456',
      ...overrides,
    },
    seq: 1,
  } as MessageContext;
}

function fakeMatch(overrides: Partial<MentionMatch> = {}): MentionMatch {
  return {
    patternName: 'jira_key',
    confidence: 0.95,
    matchText: 'DEMV-4127',
    matchStart: 9,
    matchEnd: 18,
    matchGroups: ['DEMV-4127', 'DEMV', '4127'],
    ...overrides,
  };
}

describe('buildMentionEdge', () => {
  it('baut subject_id im Format edge:mentions:<from>-><to>', () => {
    const input = buildMentionEdge(fakePayload(), fakeMatch(), 'jira:issue:DEMV-4127', fakeCtx());
    expect(input.subject_id).toBe(
      'edge:mentions:slack:msg:hackathon/C1/123.456->jira:issue:DEMV-4127',
    );
  });

  it('payload trägt from_id, to_id, type=mentions, source=mention-extractor:regex:v1', () => {
    const input = buildMentionEdge(fakePayload(), fakeMatch(), 'jira:issue:DEMV-4127', fakeCtx());
    expect(input.payload.from_id).toBe('slack:msg:hackathon/C1/123.456');
    expect(input.payload.to_id).toBe('jira:issue:DEMV-4127');
    expect(input.payload.type).toBe('mentions');
    expect(input.payload.source).toBe(EXTRACTOR_SOURCE);
    expect(input.payload.confidence).toBe(0.95);
    expect(input.payload.weight).toBe(1.0);
  });

  it('valid_from = created_at des Source-Records, valid_to = null', () => {
    const input = buildMentionEdge(
      fakePayload({ created_at: '2026-04-15T10:00:00.000Z' }),
      fakeMatch(),
      'jira:issue:DEMV-4127',
      fakeCtx(),
    );
    expect(input.payload.valid_from).toBe('2026-04-15T10:00:00.000Z');
    expect(input.payload.valid_to).toBeNull();
  });

  it('causation_id zeigt auf das auslösende record-event', () => {
    const input = buildMentionEdge(
      fakePayload(),
      fakeMatch(),
      'jira:issue:DEMV-4127',
      fakeCtx({ event_id: 'evt_xyz' }),
    );
    expect(input.causation_id).toBe('evt_xyz');
  });

  it('correlation_id wird vom record-event übernommen', () => {
    const input = buildMentionEdge(
      fakePayload(),
      fakeMatch(),
      'jira:issue:DEMV-4127',
      fakeCtx({ correlation_id: 'slack:msg:hackathon/C1/THREAD-ROOT' }),
    );
    expect(input.correlation_id).toBe('slack:msg:hackathon/C1/THREAD-ROOT');
  });

  it('evidence enthält matched_text, offsets, pattern_name, extractor_version', () => {
    const input = buildMentionEdge(fakePayload(), fakeMatch(), 'jira:issue:DEMV-4127', fakeCtx());
    expect(input.evidence).toEqual({
      matched_text: 'DEMV-4127',
      match_offset_start: 9,
      match_offset_end: 18,
      pattern_name: 'jira_key',
      extractor_version: 'regex:v1',
    });
  });

  it('source des Events ist der Extractor-Tag, nicht die Source des Records', () => {
    const input = buildMentionEdge(
      fakePayload({ source: 'slack' }),
      fakeMatch(),
      'jira:issue:DEMV-4127',
      fakeCtx(),
    );
    expect(input.source).toBe(EXTRACTOR_SOURCE);
  });
});
