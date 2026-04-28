import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractIntercomSnapshot } from './intercom';

const PWX_BIPRO = join(process.cwd(), '../../apps/playground/Dummyfiles/pwx_ideen_bipro.json');

async function loadBipro(): Promise<unknown> {
  return JSON.parse(await readFile(PWX_BIPRO, 'utf8')) as unknown;
}

const sampleEvent = (topic: string, item: Record<string, unknown>) => ({
  id: `evt_${topic}_${item['id'] ?? 'x'}`,
  topic,
  data: { item },
});

describe('extractIntercomSnapshot', () => {
  it('konvertiert conversation.user.created in eine Conversation mit Initial-Part', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1', email: 'a@b.de', name: 'Alice' },
          source: { type: 'conversation', body: 'Hello support' },
          tags: ['billing'],
        }),
      },
    });
    expect(snapshot.conversations).toHaveLength(1);
    const conv = snapshot.conversations[0]!;
    expect(conv.id).toBe('conv_1');
    expect(conv.state).toBe('open');
    expect(conv.contact.id).toBe('usr_1');
    expect(conv.contact.type).toBe('user');
    expect(conv.tags).toEqual(['billing']);
    expect(conv.parts).toHaveLength(1);
    expect(conv.parts[0]!.body).toBe('Hello support');
    expect(conv.parts[0]!.author.type).toBe('user');
    expect(snapshot.contacts).toHaveLength(1);
    expect(snapshot.contacts[0]!.id).toBe('usr_1');
  });

  it('fügt einen User-Part bei conversation.user.replied hinzu', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1', email: 'a@b.de' },
          source: { type: 'conversation', body: 'first' },
          tags: [],
        }),
        'conversation.user.replied': sampleEvent('conversation.user.replied', {
          id: 'conv_1',
          state: 'open',
          updated_at: '2026-04-28T09:14:12.000Z',
          customer: { id: 'usr_1', email: 'a@b.de' },
          last_message: {
            author_type: 'user',
            body: 'still broken',
            created_at: '2026-04-28T09:14:12.000Z',
          },
        }),
      },
    });
    const conv = snapshot.conversations[0]!;
    expect(conv.parts).toHaveLength(2);
    expect(conv.parts[1]!.body).toBe('still broken');
    expect(conv.parts[1]!.author.type).toBe('user');
  });

  it('fügt einen Admin-Part bei conversation.admin.replied hinzu und sammelt den Agent', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1' },
          source: { type: 'conversation', body: 'first' },
          tags: [],
        }),
        'conversation.admin.replied': sampleEvent('conversation.admin.replied', {
          id: 'conv_1',
          state: 'open',
          updated_at: '2026-04-28T09:20:44.000Z',
          admin: { id: 'adm_88', name: 'Support Agent' },
          last_message: {
            author_type: 'admin',
            body: 'looking into it',
            created_at: '2026-04-28T09:20:44.000Z',
          },
        }),
      },
    });
    const conv = snapshot.conversations[0]!;
    expect(conv.parts).toHaveLength(2);
    expect(conv.parts[1]!.author.type).toBe('admin');
    expect(conv.parts[1]!.author.id).toBe('adm_88');
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]!.name).toBe('Support Agent');
  });

  it('setzt state=closed bei conversation.admin.closed', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1' },
          source: { type: 'conversation', body: 'first' },
          tags: [],
        }),
        'conversation.admin.closed': sampleEvent('conversation.admin.closed', {
          id: 'conv_1',
          state: 'closed',
          closed_at: '2026-04-28T10:05:19.000Z',
          closed_by: { id: 'adm_88', name: 'Support Agent' },
          resolution_note: 'fixed',
        }),
      },
    });
    expect(snapshot.conversations[0]!.state).toBe('closed');
  });

  it('addiert Tags via contact.tag.created an den Contact', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1', email: 'a@b.de' },
          source: { type: 'conversation', body: 'x' },
          tags: ['billing'],
        }),
        'contact.tag.created': sampleEvent('contact.tag.created', {
          contact: { id: 'usr_1', email: 'a@b.de' },
          tag: { id: 'tag_1', name: 'high-priority' },
          created_at: '2026-04-28T10:07:00.000Z',
        }),
      },
    });
    expect(snapshot.contacts[0]!.id).toBe('usr_1');
    // Tag-Liste auf der Conversation bekommt den neuen Tag — Conversation ist
    // semantisch der Ort wo der Snapshot tags liest.
    expect(snapshot.conversations[0]!.tags).toContain('billing');
  });

  it('trennt Conversations sauber bei verschiedenen conv-IDs', () => {
    const snapshot = extractIntercomSnapshot({
      cluster: 'foo',
      intercom: {
        'conversation.user.created': sampleEvent('conversation.user.created', {
          id: 'conv_1',
          state: 'open',
          created_at: '2026-04-28T09:10:00.000Z',
          customer: { id: 'usr_1' },
          source: { type: 'conversation', body: 'one' },
          tags: [],
        }),
        'conversation.user.replied': sampleEvent('conversation.user.replied', {
          id: 'conv_2',
          state: 'open',
          updated_at: '2026-04-28T09:11:00.000Z',
          customer: { id: 'usr_2' },
          last_message: {
            author_type: 'user',
            body: 'two',
            created_at: '2026-04-28T09:11:00.000Z',
          },
        }),
      },
    });
    expect(snapshot.conversations).toHaveLength(2);
    const ids = snapshot.conversations.map((c) => c.id).sort();
    expect(ids).toEqual(['conv_1', 'conv_2']);
  });

  it('akzeptiert die echte pwx_ideen_bipro intercom-section', async () => {
    const container = await loadBipro();
    const snapshot = extractIntercomSnapshot(container);
    expect(snapshot.conversations.length).toBeGreaterThan(0);
    expect(snapshot.contacts.length).toBeGreaterThan(0);
  });

  it('wirft, wenn der Container keine intercom-section hat', () => {
    expect(() => extractIntercomSnapshot({ cluster: 'foo' })).toThrow(/intercom/i);
  });
});
