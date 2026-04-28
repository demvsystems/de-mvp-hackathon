import { describe, expect, it } from 'vitest';
import { PendingMentions } from './pending';
import type { MentionMatch } from './patterns';

function fakeMatch(text: string, patternName = 'jira_key'): MentionMatch {
  return {
    patternName,
    confidence: 0.95,
    matchText: text,
    matchStart: 0,
    matchEnd: text.length,
    matchGroups: [text],
  };
}

describe('PendingMentions', () => {
  it('startet leer', () => {
    const pending = new PendingMentions();
    expect(pending.size()).toBe(0);
  });

  it('addJiraKey speichert eine Mention zum Auflösen bei späterem Issue', () => {
    const pending = new PendingMentions();
    pending.addJiraKey('DEMV-9999', 'slack:msg:hackathon/C1/123.1', fakeMatch('DEMV-9999'));
    expect(pending.size()).toBe(1);
  });

  it('resolveJiraKey liefert alle pending-Einträge zum Key und leert den Slot', () => {
    const pending = new PendingMentions();
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', fakeMatch('DEMV-9999'));
    pending.addJiraKey('DEMV-9999', 'slack:msg:B', fakeMatch('DEMV-9999'));
    pending.addJiraKey('SHOP-1', 'slack:msg:C', fakeMatch('SHOP-1'));

    const resolved = pending.resolveJiraKey('DEMV-9999', 'jira:issue:DEMV-9999');
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.fromRecordId).sort()).toEqual(['slack:msg:A', 'slack:msg:B']);
    for (const r of resolved) {
      expect(r.targetId).toBe('jira:issue:DEMV-9999');
    }
    // SHOP-1 bleibt pending
    expect(pending.size()).toBe(1);
  });

  it('resolveJiraKey ohne pending-Einträge liefert leeres Array', () => {
    const pending = new PendingMentions();
    expect(pending.resolveJiraKey('DEMV-9999', 'jira:issue:DEMV-9999')).toEqual([]);
  });

  it('Idempotenz: zweimaliges add mit identischem fromRecordId+match wird entdoppelt', () => {
    const pending = new PendingMentions();
    const m = fakeMatch('DEMV-9999');
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', m);
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', m);
    expect(pending.size()).toBe(1);
  });

  it('verschiedene Match-Offsets im selben Record bleiben getrennt (zwei Mentions im Body)', () => {
    const pending = new PendingMentions();
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', { ...fakeMatch('DEMV-9999'), matchStart: 5 });
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', { ...fakeMatch('DEMV-9999'), matchStart: 50 });
    expect(pending.size()).toBe(2);
  });

  it('resolved entries enthalten match-Daten unverändert (für Edge-Evidence)', () => {
    const pending = new PendingMentions();
    const m = fakeMatch('DEMV-9999');
    pending.addJiraKey('DEMV-9999', 'slack:msg:A', m);

    const [resolved] = pending.resolveJiraKey('DEMV-9999', 'jira:issue:DEMV-9999');
    expect(resolved!.match).toEqual(m);
    expect(resolved!.fromRecordId).toBe('slack:msg:A');
    expect(resolved!.targetId).toBe('jira:issue:DEMV-9999');
  });
});
