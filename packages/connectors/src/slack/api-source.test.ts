import { describe, expect, it, vi } from 'vitest';
import { SlackApiSource } from './api-source';
import { map } from './handle';
import { assertContractValid } from '../core';

/**
 * Baut ein fetch-Mock, das URLs auf JSON-Responses mappt. Pfad-Match per
 * `endsWith` plus Query-String-Lookup, damit wir pro Cursor unterschiedliche
 * Antworten zurückgeben können (Pagination-Tests).
 */
function buildFetchMock(routes: Record<string, unknown[]>): typeof globalThis.fetch {
  const callCounts: Record<string, number> = {};
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const path = u.pathname;
    const method = path.split('/').pop() ?? '';
    const responses = routes[method];
    if (!responses) {
      throw new Error(`Unerwarteter API-Call: ${method} (${url})`);
    }
    const idx = callCounts[method] ?? 0;
    callCounts[method] = idx + 1;
    const body = responses[idx] ?? responses[responses.length - 1];
    return new Response(JSON.stringify({ ok: true, ...(body as object) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
}

const CHANNEL_INFO = {
  channel: {
    id: 'C111',
    name: 'produkt1',
    is_private: false,
    topic: { value: 'Abstimmung zu Produkt 1' },
    purpose: { value: 'Planung' },
  },
};

const MEMBERS = {
  members: ['U001', 'U002'],
  response_metadata: { next_cursor: '' },
};

const USER_001 = {
  user: {
    id: 'U001',
    name: 'anna',
    real_name: 'Anna Keller',
    profile: { display_name: 'Anna', real_name: 'Anna Keller', title: 'Product Owner' },
  },
};

const USER_002 = {
  user: {
    id: 'U002',
    name: 'ben',
    real_name: 'Ben Schneider',
    profile: { display_name: 'Ben', real_name: 'Ben Schneider', title: 'Developer' },
  },
};

describe('SlackApiSource', () => {
  it('baut einen Snapshot aus den API-Responses', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [MEMBERS],
      'users.info': [USER_001, USER_002],
      'conversations.history': [
        {
          messages: [
            {
              type: 'message',
              user: 'U001',
              text: 'Guten Morgen, zwei offene Punkte vor Release.',
              ts: '1777367010.000100',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    const items: unknown[] = [];
    for await (const item of source.items()) items.push(item);

    expect(items).toHaveLength(1);
    const snap = items[0] as {
      channel: { id: string; type: string; topic?: string };
      participants: Array<{ id: string; display_name: string; role_hint?: string }>;
      content: Array<{ id: string; text: string; type: string; thread?: unknown }>;
    };

    expect(snap.channel.id).toBe('C111');
    expect(snap.channel.type).toBe('public_channel');
    expect(snap.channel.topic).toBe('Abstimmung zu Produkt 1');

    expect(snap.participants).toHaveLength(2);
    expect(snap.participants[0]?.id).toBe('U001');
    expect(snap.participants[0]?.role_hint).toBe('Product Owner');

    expect(snap.content).toHaveLength(1);
    expect(snap.content[0]?.type).toBe('chat_message');
    expect(snap.content[0]?.text).toContain('Release');
  });

  it('lädt Thread-Replies bei reply_count > 0 nach', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [{ members: ['U001'], response_metadata: { next_cursor: '' } }],
      'users.info': [USER_001],
      'conversations.history': [
        {
          messages: [
            {
              type: 'message',
              user: 'U001',
              text: 'Top-Level',
              ts: '1777367010.000100',
              thread_ts: '1777367010.000100',
              reply_count: 2,
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
      'conversations.replies': [
        {
          messages: [
            // Slack liefert die Top-Level-Message als ersten Eintrag mit zurück
            {
              type: 'message',
              user: 'U001',
              text: 'Top-Level',
              ts: '1777367010.000100',
              thread_ts: '1777367010.000100',
              reply_count: 2,
            },
            {
              type: 'message',
              user: 'U001',
              text: 'Reply 1',
              ts: '1777367020.000200',
              thread_ts: '1777367010.000100',
            },
            {
              type: 'message',
              user: 'U001',
              text: 'Reply 2',
              ts: '1777367030.000300',
              thread_ts: '1777367010.000100',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: any;
    for await (const item of source.items()) snap = item;

    expect(snap.content).toHaveLength(1);
    expect(snap.content[0].thread).toBeDefined();
    expect(snap.content[0].thread.messages).toHaveLength(2);
    expect(snap.content[0].thread.messages[0].text).toBe('Reply 1');
    expect(snap.content[0].thread.messages[1].text).toBe('Reply 2');
    expect(snap.content[0].thread.messages[0].type).toBe('thread_reply');
  });

  it('filtert Bot-Messages und Service-Subtypes', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [{ members: ['U001'], response_metadata: { next_cursor: '' } }],
      'users.info': [USER_001],
      'conversations.history': [
        {
          messages: [
            { type: 'message', user: 'U001', text: 'echte Nachricht', ts: '1777367010.000100' },
            {
              type: 'message',
              subtype: 'channel_join',
              user: 'U002',
              text: 'has joined',
              ts: '1777367020.000200',
            },
            {
              type: 'message',
              subtype: 'bot_message',
              bot_id: 'B999',
              text: 'bot output',
              ts: '1777367030.000300',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: any;
    for await (const item of source.items()) snap = item;

    expect(snap.content).toHaveLength(1);
    expect(snap.content[0].text).toBe('echte Nachricht');
  });

  it('paginiert conversations.history über mehrere Cursor', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [{ members: ['U001'], response_metadata: { next_cursor: '' } }],
      'users.info': [USER_001],
      'conversations.history': [
        {
          messages: [{ type: 'message', user: 'U001', text: 'msg-1', ts: '1777367010.000100' }],
          response_metadata: { next_cursor: 'next-token' },
        },
        {
          messages: [{ type: 'message', user: 'U001', text: 'msg-2', ts: '1777367020.000200' }],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: any;
    for await (const item of source.items()) snap = item;

    expect(snap.content).toHaveLength(2);
    expect(snap.content.map((m: any) => m.text)).toEqual(['msg-1', 'msg-2']);
  });

  it('extrahiert <@U…>-Mentions aus dem Body', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [
        { members: ['U001', 'U002'], response_metadata: { next_cursor: '' } },
      ],
      'users.info': [USER_001, USER_002],
      'conversations.history': [
        {
          messages: [
            {
              type: 'message',
              user: 'U001',
              text: 'Hi <@U002>, kannst du das angucken?',
              ts: '1777367010.000100',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: any;
    for await (const item of source.items()) snap = item;

    expect(snap.content[0].mentions).toEqual(['U002']);
  });

  it('konvertiert ts in ISO-8601 UTC', async () => {
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [{ members: ['U001'], response_metadata: { next_cursor: '' } }],
      'users.info': [USER_001],
      'conversations.history': [
        {
          messages: [{ type: 'message', user: 'U001', text: 'x', ts: '1745835810.000000' }],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: any;
    for await (const item of source.items()) snap = item;

    expect(snap.content[0].datetime).toBe('2025-04-28T10:23:30.000Z');
  });

  it('wirft bei nicht-OK-Response von Slack', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    await expect(async () => {
      for await (const _ of source.items()) {
        // unreachable
      }
    }).rejects.toThrow(/invalid_auth/);
  });

  it('wirft bei dauerhaftem 429 nach erschöpften Versuchen', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('rate limited', { status: 429 });
    }) as unknown as typeof globalThis.fetch;

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
      retry: { maxAttempts: 2, sleep: () => Promise.resolve(), onRetry: () => {} },
    });

    await expect(async () => {
      for await (const _ of source.items()) {
        // unreachable
      }
    }).rejects.toThrow(/rate limit \(HTTP 429\) nach 3 Versuchen/);
    // Erstaufruf + 2 Retries = 3 fetches
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('Snapshot durchläuft den Mapper ohne Vertragsverletzung', async () => {
    // End-to-end: API-Response → SlackApiSource → SlackSnapshot → handle.map →
    // Emissions, die das Messaging-Vertragsschema erfüllen.
    const fetchMock = buildFetchMock({
      'conversations.info': [CHANNEL_INFO],
      'conversations.members': [{ members: ['U001'], response_metadata: { next_cursor: '' } }],
      'users.info': [USER_001],
      'conversations.history': [
        {
          messages: [
            {
              type: 'message',
              user: 'U001',
              text: 'Hello world',
              ts: '1777367010.000100',
              thread_ts: '1777367010.000100',
              reply_count: 1,
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
      'conversations.replies': [
        {
          messages: [
            {
              type: 'message',
              user: 'U001',
              text: 'Hello world',
              ts: '1777367010.000100',
              thread_ts: '1777367010.000100',
              reply_count: 1,
            },
            {
              type: 'message',
              user: 'U001',
              text: 'Reply',
              ts: '1777367020.000200',
              thread_ts: '1777367010.000100',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      ],
    });

    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: fetchMock,
    });

    let snap: unknown;
    for await (const item of source.items()) snap = item;

    const out = map(snap);
    expect(out.emissions.length).toBeGreaterThan(0);
    expect(() => assertContractValid(out.emissions)).not.toThrow();
  });
});

describe('SlackApiSource retries', () => {
  /**
   * Sequenziertes fetch-Mock, das pro Aufruf eine Reaktion abarbeitet — egal
   * für welche URL. Reaktion ist entweder eine `Response` (z. B. 429 oder
   * 500) oder ein zu werfender Fehler (`Error`-Instanz). Damit lassen sich
   * gemischte Sequenzen aus Fehlschlägen + Erfolgsantworten testen, ohne pro
   * URL eine separate Liste zu pflegen — wir testen ohnehin nur die erste
   * Methode (`conversations.info`).
   */
  function sequenceFetch(seq: Array<Response | Error | (() => Response | Error)>): {
    fetch: typeof globalThis.fetch;
    calls: number;
  } {
    let i = 0;
    const fn = vi.fn(async () => {
      const next = seq[i] ?? seq[seq.length - 1];
      i += 1;
      const value = typeof next === 'function' ? next() : next;
      if (value instanceof Error) throw value;
      return value as Response;
    }) as unknown as typeof globalThis.fetch;
    return {
      fetch: fn,
      get calls() {
        return (fn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      },
    };
  }

  function okJson(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify({ ok: true, ...(body as object) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  }

  /** Triggert nur einen einzelnen API-Call, indem `conversations.info` 401 wirft. */
  async function runUntilFirstFailure(opts: {
    fetch: typeof globalThis.fetch;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (info: import('./api-source').RetryInfo) => void;
    maxAttempts?: number;
  }): Promise<unknown> {
    const source = new SlackApiSource({
      token: 'xoxb-test',
      channelId: 'C111',
      fetch: opts.fetch,
      retry: {
        sleep: opts.sleep ?? (() => Promise.resolve()),
        onRetry: opts.onRetry ?? (() => {}),
        ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
      },
    });
    let snap: unknown;
    for await (const item of source.items()) snap = item;
    return snap;
  }

  it('retry bei HTTP 429, dann Erfolg', async () => {
    const seq = sequenceFetch([
      new Response('throttled', { status: 429, headers: { 'Retry-After': '0' } }),
      okJson({
        channel: {
          id: 'C111',
          name: 'produkt1',
          is_private: false,
          topic: { value: 't' },
          purpose: { value: 'p' },
        },
      }),
      okJson({ members: [], response_metadata: { next_cursor: '' } }),
      okJson({ messages: [], response_metadata: { next_cursor: '' } }),
    ]);
    const onRetry = vi.fn();
    const snap = (await runUntilFirstFailure({ fetch: seq.fetch, onRetry })) as {
      channel: { id: string };
    };
    expect(snap.channel.id).toBe('C111');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ reason: 'http_429', status: 429 });
  });

  it('retry bei HTTP 5xx mit exponential backoff', async () => {
    const seq = sequenceFetch([
      new Response('boom', { status: 503 }),
      new Response('boom', { status: 502 }),
      okJson({
        channel: {
          id: 'C111',
          name: 'produkt1',
          is_private: false,
          topic: { value: 't' },
          purpose: { value: 'p' },
        },
      }),
      okJson({ members: [], response_metadata: { next_cursor: '' } }),
      okJson({ messages: [], response_metadata: { next_cursor: '' } }),
    ]);
    const onRetry = vi.fn();
    const snap = (await runUntilFirstFailure({ fetch: seq.fetch, onRetry })) as {
      channel: { id: string };
    };
    expect(snap.channel.id).toBe('C111');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls.map((c) => (c[0] as { status?: number }).status)).toEqual([503, 502]);
  });

  it('retry bei Slack-soft-rate-limit (HTTP 200, ok=false, error=ratelimited)', async () => {
    const seq = sequenceFetch([
      new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
      }),
      okJson({
        channel: {
          id: 'C111',
          name: 'produkt1',
          is_private: false,
          topic: { value: 't' },
          purpose: { value: 'p' },
        },
      }),
      okJson({ members: [], response_metadata: { next_cursor: '' } }),
      okJson({ messages: [], response_metadata: { next_cursor: '' } }),
    ]);
    const onRetry = vi.fn();
    const snap = (await runUntilFirstFailure({ fetch: seq.fetch, onRetry })) as {
      channel: { id: string };
    };
    expect(snap.channel.id).toBe('C111');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ reason: 'slack_ratelimited' });
  });

  it('retry bei Network-Error (fetch wirft)', async () => {
    const seq = sequenceFetch([
      new Error('ECONNRESET'),
      okJson({
        channel: {
          id: 'C111',
          name: 'produkt1',
          is_private: false,
          topic: { value: 't' },
          purpose: { value: 'p' },
        },
      }),
      okJson({ members: [], response_metadata: { next_cursor: '' } }),
      okJson({ messages: [], response_metadata: { next_cursor: '' } }),
    ]);
    const onRetry = vi.fn();
    const snap = (await runUntilFirstFailure({ fetch: seq.fetch, onRetry })) as {
      channel: { id: string };
    };
    expect(snap.channel.id).toBe('C111');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({
      reason: 'network_error',
      error: 'ECONNRESET',
    });
  });

  it('respektiert Retry-After-Header bei 429', async () => {
    const seq = sequenceFetch([
      new Response('throttled', { status: 429, headers: { 'Retry-After': '7' } }),
      okJson({
        channel: {
          id: 'C111',
          name: 'produkt1',
          is_private: false,
          topic: { value: 't' },
          purpose: { value: 'p' },
        },
      }),
      okJson({ members: [], response_metadata: { next_cursor: '' } }),
      okJson({ messages: [], response_metadata: { next_cursor: '' } }),
    ]);
    const sleeps: number[] = [];
    await runUntilFirstFailure({
      fetch: seq.fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    // Retry-After: 7 → 7000 ms (Slack sendet Sekunden, nicht ms)
    expect(sleeps).toEqual([7000]);
  });

  it('keine Retries bei 4xx (ausser 429) — wirft sofort', async () => {
    const seq = sequenceFetch([new Response('unauthorized', { status: 401 })]);
    const onRetry = vi.fn();
    await expect(runUntilFirstFailure({ fetch: seq.fetch, onRetry })).rejects.toThrow(/HTTP 401/);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keine Retries bei sonstigem ok=false (z. B. invalid_auth)', async () => {
    const seq = sequenceFetch([
      new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);
    const onRetry = vi.fn();
    await expect(runUntilFirstFailure({ fetch: seq.fetch, onRetry })).rejects.toThrow(
      /invalid_auth/,
    );
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('wirft nach erschöpfter maxAttempts', async () => {
    const seq = sequenceFetch([
      new Response('boom', { status: 503 }),
      new Response('boom', { status: 503 }),
      new Response('boom', { status: 503 }),
    ]);
    await expect(runUntilFirstFailure({ fetch: seq.fetch, maxAttempts: 2 })).rejects.toThrow(
      /HTTP 503 nach 3 Versuchen/,
    );
  });
});
