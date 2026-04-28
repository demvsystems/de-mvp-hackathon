import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatIntercomResponse,
  formatJiraResponse,
  formatSlackResponse,
  formatUpvotyResponse,
} from './formatters';
import { generatePreview } from './generate-preview';
import { formatFilename } from './generator-utils';
import { loadRawTemplateForSource } from './template-loader';

function walkStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const entry of node) walkStrings(entry, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) walkStrings(value, out);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env['OPENAI_API_KEY'];
});

describe('generate preview fallback', () => {
  it('uses fallback when OPENAI_API_KEY is missing', async () => {
    delete process.env['OPENAI_API_KEY'];
    const res = await generatePreview({
      source: 'jira',
      topic: 'CSV Import broken',
      product: 'dummy-tool',
      category: 'bug',
      language: 'de',
      count: 2,
      detailLevel: 'medium',
      severity: 'medium',
      sentiment: 'frustrated',
    });
    expect(res.generationMode).toBe('fallback');
    expect(res.warnings.join(' ')).toContain('OPENAI_API_KEY missing');
  });

  it('returns requested count and json filenames', async () => {
    delete process.env['OPENAI_API_KEY'];
    const res = await generatePreview({
      source: 'jira',
      topic: 'CSV Import broken',
      product: 'dummy-tool',
      category: 'bug',
      language: 'de',
      count: 4,
      detailLevel: 'medium',
      severity: 'medium',
      sentiment: 'frustrated',
    });

    expect(res.items).toHaveLength(4);
    expect(res.validation).toHaveLength(4);
    for (const item of res.items) {
      expect(item.filename.endsWith('.json')).toBe(true);
      expect(item.filename.endsWith('.jsonl')).toBe(false);
      expect(item.filename.includes('/')).toBe(false);
      expect(item.filename.includes('\\')).toBe(false);
    }
  });

  it('is deterministic for same input and fixed date', async () => {
    delete process.env['OPENAI_API_KEY'];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T10:00:00.000Z'));

    const input = {
      source: 'slack' as const,
      topic: 'Checkout error',
      product: 'internal-bot',
      category: 'incident',
      language: 'en',
      count: 2,
      detailLevel: 'high' as const,
      severity: 'high' as const,
      sentiment: 'negative' as const,
    };

    const a = await generatePreview(input);
    const b = await generatePreview(input);
    expect(a).toEqual(b);
    vi.useRealTimers();
  });

  it('preserves top-level template keys', async () => {
    delete process.env['OPENAI_API_KEY'];
    const template = await loadRawTemplateForSource('intercom');
    const expectedKeys = Object.keys(template.template).sort();

    const res = await generatePreview({
      source: 'intercom',
      topic: 'routing issue',
      product: 'support-hub',
      category: 'feedback',
      language: 'en',
      count: 1,
      detailLevel: 'low',
      severity: 'low',
      sentiment: 'neutral',
    });

    const first = res.items[0];
    expect(first).toBeTruthy();
    const keys = Object.keys(first!.content).sort();
    expect(keys).toEqual(expectedKeys);
    expect(res.validation[0]?.filename).toBe(first?.filename);
  });

  it('generates only safe domains', async () => {
    delete process.env['OPENAI_API_KEY'];
    const res = await generatePreview({
      source: 'jira',
      topic: 'domain check',
      product: 'dummy-platform',
      category: 'qa',
      language: 'en',
      count: 2,
      detailLevel: 'low',
      severity: 'low',
      sentiment: 'neutral',
    });

    const allowed = ['example.com', 'example.org', 'example.net', 'example.test'];
    const domains = walkStrings(res).flatMap((text) =>
      (text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []).map((d) => d.toLowerCase()),
    );
    for (const domain of domains) {
      const ok = allowed.includes(domain) || allowed.some((root) => domain.endsWith(`.${root}`));
      expect(ok).toBe(true);
    }
  });

  it('filename format is stable and safe', () => {
    const filename = formatFilename({
      date: new Date('2026-04-28T00:00:00.000Z'),
      source: 'upvoty',
      category: 'Bug / Escalation',
      topic: 'CSV-Import bricht bei großen Dateien ab',
      index: 0,
    });
    expect(filename).toBe(
      '2026-04-28_upvoty_bug-escalation_csv-import-bricht-bei-groen-dateien-ab_001.json',
    );
  });

  it('uses AI mode when OPENAI_API_KEY exists and AI returns valid payload', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      content: {
                        id: 'ISSUE-1',
                        topic: 'Login doesnt work',
                        product: 'Portal',
                        category: 'bug',
                        language: 'de',
                        severity: 'high',
                        sentiment: 'frustrated',
                        summary: 'Login fails after release',
                        details: 'Users cannot sign in',
                        reportedBy: 'someone@company.com',
                        messages: [
                          {
                            text: '[DUMMY] Login doesnt work for multiple users',
                          },
                        ],
                        channel: {
                          name: 'support-login',
                          topic: 'Login doesnt work',
                          purpose: 'Investigating login outage',
                        },
                        participants: [
                          {
                            id: 'U900',
                            display_name: 'Dummy Analyst',
                            team_id: 'DE-MVP',
                          },
                        ],
                        content: [],
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }),
    );

    const res = await generatePreview({
      source: 'slack',
      topic: 'Checkout error',
      product: 'internal-bot',
      category: 'incident',
      language: 'en',
      count: 1,
      detailLevel: 'high',
      severity: 'high',
      sentiment: 'negative',
    });

    expect(res.generationMode).toBe('ai');
    expect(res.items).toHaveLength(1);
    expect(res.validation).toHaveLength(1);
    const first = res.items[0];
    expect(first).toBeTruthy();
    expect(first!.filename).toMatch(/^2026-\d{2}-\d{2}_slack_incident_checkout-error_\d{3}\.json$/);

    const topKeys = Object.keys(first!.content).sort();
    expect(topKeys).toEqual(['channel', 'content', 'participants']);
    expect(topKeys).not.toContain('summary');
    expect(topKeys).not.toContain('details');
    expect(topKeys).not.toContain('reportedBy');
    expect(topKeys).not.toContain('messages');

    const strings = walkStrings(first!.content).join('\n').toLowerCase();
    expect(strings).toContain('login doesnt work');
    expect(strings).not.toContain('export-performance');
    expect(strings).not.toContain('tariflogik');
    expect(strings).not.toContain('kundenimport');
    expect(strings).not.toContain('release-kandidaten');

    const content = first!.content['content'];
    expect(Array.isArray(content)).toBe(true);
    expect((content as Array<unknown>).length).toBeGreaterThan(0);
  });

  it('falls back when AI request fails', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'API failed' } }),
      }),
    );

    const res = await generatePreview({
      source: 'jira',
      topic: 'Failure test',
      product: 'internal-tool',
      category: 'bug',
      language: 'de',
      count: 1,
      detailLevel: 'medium',
      severity: 'medium',
      sentiment: 'neutral',
    });
    expect(res.generationMode).toBe('fallback');
    expect(res.warnings.join(' ')).toContain('AI generation failed');
  });

  it('falls back when AI returns malformed JSON', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{not-json' } }],
        }),
      }),
    );

    const res = await generatePreview({
      source: 'upvoty',
      topic: 'Malformed json',
      product: 'portal',
      category: 'feedback',
      language: 'en',
      count: 1,
      detailLevel: 'low',
      severity: 'low',
      sentiment: 'neutral',
    });
    expect(res.generationMode).toBe('fallback');
    expect(res.warnings.join(' ')).toContain('malformed JSON');
  });

  it('falls back when AI returns unsafe domains', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      content: {
                        source: { jiraSite: 'evil.com' },
                        projects: [],
                        boards: [],
                        activeSprints: [],
                        issues: [{ descriptionText: '[DUMMY] text' }],
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }),
    );

    const res = await generatePreview({
      source: 'jira',
      topic: 'Unsafe domain',
      product: 'portal',
      category: 'bug',
      language: 'en',
      count: 1,
      detailLevel: 'low',
      severity: 'low',
      sentiment: 'neutral',
    });
    expect(res.generationMode).toBe('fallback');
    expect(res.warnings.join(' ')).toContain('unsafe domain');
  });
});

describe('formatters smoke test', () => {
  const ctx = {
    source: 'jira' as const,
    topic: 'Topic',
    product: 'Tool',
    category: 'bug',
    language: 'de',
    detailLevel: 'medium',
    severity: 'medium',
    sentiment: 'neutral',
    count: 1,
  };

  it('formatJiraResponse preserves top keys', async () => {
    const template = await loadRawTemplateForSource('jira');
    const out = formatJiraResponse(template.template, { ...ctx, source: 'jira' }, 0);
    expect(Object.keys(out).sort()).toEqual(Object.keys(template.template).sort());
  });

  it('formatSlackResponse preserves top keys', async () => {
    const template = await loadRawTemplateForSource('slack');
    const out = formatSlackResponse(template.template, { ...ctx, source: 'slack' }, 0);
    expect(Object.keys(out).sort()).toEqual(Object.keys(template.template).sort());
  });

  it('formatSlackResponse emits reactions and defaults team_id when missing', () => {
    const template = {
      channel: {
        id: 'C1',
        name: 'dummy',
      },
      participants: [
        {
          id: 'U1',
          display_name: 'Dummy',
        },
      ],
      content: [
        {
          type: 'chat_message',
          id: 'msg_1',
          text: 'hello',
          thread: {
            id: 'thread_1',
            messages: [
              {
                id: 'reply_1',
                text: 'reply',
              },
            ],
          },
        },
      ],
    } satisfies Record<string, unknown>;

    const out = formatSlackResponse(template, { ...ctx, source: 'slack' }, 0);

    const channel = out['channel'] as Record<string, unknown>;
    expect(channel['team_id']).toBe('DE-MVP');

    const firstParticipant = (out['participants'] as Array<Record<string, unknown>>)[0];
    expect(firstParticipant?.['team_id']).toBe('DE-MVP');

    const firstMessage = (out['content'] as Array<Record<string, unknown>>)[0];
    expect(firstMessage?.['team_id']).toBe('DE-MVP');
    expect(Array.isArray(firstMessage?.['reactions'])).toBe(true);
    expect((firstMessage?.['reactions'] as Array<unknown>).length).toBeGreaterThan(0);

    const thread = firstMessage?.['thread'] as Record<string, unknown>;
    const firstReply = (thread?.['messages'] as Array<Record<string, unknown>>)?.[0];
    expect(firstReply?.['team_id']).toBe('DE-MVP');
    expect(Array.isArray(firstReply?.['reactions'])).toBe(true);
  });

  it('formatUpvotyResponse preserves top keys', async () => {
    const template = await loadRawTemplateForSource('upvoty');
    const out = formatUpvotyResponse(template.template, { ...ctx, source: 'upvoty' }, 0);
    expect(Object.keys(out).sort()).toEqual(Object.keys(template.template).sort());
  });

  it('formatIntercomResponse preserves top keys', async () => {
    const template = await loadRawTemplateForSource('intercom');
    const out = formatIntercomResponse(template.template, { ...ctx, source: 'intercom' }, 0);
    expect(Object.keys(out).sort()).toEqual(Object.keys(template.template).sort());
  });
});
