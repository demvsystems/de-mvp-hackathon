import { z } from 'zod';
import type { IngestionSource } from '../core';
import {
  SlackSnapshot,
  type SlackChatMessage,
  type SlackSnapshot as SlackSnapshotT,
} from './schema';

/**
 * Live-Reader gegen die Slack Web API. Erfüllt die gleiche `IngestionSource`-
 * Schnittstelle wie `JsonSnapshotSource` und liefert genau ein
 * `SlackSnapshot`-Item — aggregiert aus mehreren API-Calls:
 *
 *  - `conversations.info` → channel-Metadaten
 *  - `conversations.members` → user-IDs
 *  - `users.info` (pro user) → Display-Felder
 *  - `conversations.history` (paginiert) → Top-Level-Messages
 *  - `conversations.replies` (pro Thread mit `reply_count > 0`) → Replies
 *
 * Bot-Messages (`subtype === 'bot_message'`) und Service-Subtypes
 * (`channel_join`, `channel_leave`, …) werden gefiltert — das Schema
 * erwartet `chat_message`/`thread_reply` mit `author.id`.
 */

export interface SlackApiOptions {
  readonly token: string;
  readonly channelId: string;
  /** Optional: Backfill-Cutoff als Unix-Timestamp-String (sek), wie Slack es erwartet. */
  readonly oldest?: string;
  /** Override für Tests. Default: globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Override für Tests. Default: 'https://slack.com/api'. */
  readonly baseUrl?: string;
  /**
   * Retry-Konfiguration für transiente Fehler (HTTP 429, 5xx, Slack-soft-rate-limit
   * `{ ok: false, error: 'ratelimited' }`, Netzwerkfehler). 4xx (außer 429) und
   * andere `ok: false`-Antworten werden sofort geworfen.
   */
  readonly retry?: {
    /** Default 4 (= max. 4 zusätzliche Versuche nach dem ersten Fehlschlag). */
    maxAttempts?: number;
    /** Backoff in ms abhängig vom 0-basierten Versuch. Default: 250 · 2^attempt + Jitter. */
    delayMs?: (attempt: number) => number;
    /** Sleep-Implementierung (für Tests). Default: setTimeout-basiert. */
    sleep?: (ms: number) => Promise<void>;
    /** Logger pro Retry. Default: console.error. */
    onRetry?: (info: RetryInfo) => void;
  };
}

export interface RetryInfo {
  readonly method: string;
  /** 0-basiert: 0 = erster Retry nach dem ersten Fehlschlag. */
  readonly attempt: number;
  readonly reason: 'http_429' | 'http_5xx' | 'slack_ratelimited' | 'network_error';
  readonly status?: number;
  readonly retryAfterMs: number;
  readonly error?: string;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_BASE_MS = 250;

function defaultBackoffMs(attempt: number): number {
  // 250, 500, 1000, 2000 ms — exponentiell, dazu ±20% Jitter, damit parallele
  // Caller nicht synchron erneut hämmern.
  const base = DEFAULT_BACKOFF_BASE_MS * 2 ** attempt;
  const jitter = (Math.random() - 0.5) * 0.4 * base;
  return Math.max(0, base + jitter);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultOnRetry(info: RetryInfo): void {
  console.error(
    `[slack-api] retry ${info.method} attempt=${info.attempt + 1} reason=${info.reason}` +
      (info.status !== undefined ? ` status=${info.status}` : '') +
      (info.error ? ` error=${info.error}` : '') +
      ` waiting=${Math.round(info.retryAfterMs)}ms`,
  );
}

/**
 * Liest `Retry-After` als Sekunden-Integer (Slack-Konvention) und konvertiert
 * in ms. Slack sendet bei rate limits einen Integer; HTTP erlaubt auch
 * HTTP-Date — den Fall ignorieren wir hier, weil Slack ihn nicht nutzt.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const sec = Number(header);
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
  return undefined;
}

export class SlackApiSource implements IngestionSource<SlackSnapshotT> {
  constructor(private readonly opts: SlackApiOptions) {}

  async *items(): AsyncIterable<SlackSnapshotT> {
    const client = new SlackWebClient(this.opts);
    const snapshot = await buildSnapshot(client, this.opts.channelId, this.opts.oldest);
    yield SlackSnapshot.parse(snapshot);
  }
}

// ── HTTP-Client ────────────────────────────────────────────────────────────

class SlackWebClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly maxAttempts: number;
  private readonly delayMs: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onRetry: (info: RetryInfo) => void;

  constructor(opts: SlackApiOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? 'https://slack.com/api';
    this.token = opts.token;
    this.maxAttempts = opts.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.delayMs = opts.retry?.delayMs ?? defaultBackoffMs;
    this.sleep = opts.retry?.sleep ?? defaultSleep;
    this.onRetry = opts.retry?.onRetry ?? defaultOnRetry;
  }

  async get<T>(method: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${method}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const init: RequestInit = {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    };

    // Retry-Schleife: ein erster Versuch + bis zu `maxAttempts` Retries für
    // transient Fehler. Network-Fehler, 429, 5xx und Slack-soft-rate-limit
    // werden retried; alles andere wirft sofort.
    let attempt = 0;
    while (true) {
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), init);
      } catch (err) {
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `Slack ${method} network error nach ${attempt + 1} Versuchen: ${errorMessage(err)}`,
          );
        }
        const wait = this.delayMs(attempt);
        this.onRetry({
          method,
          attempt,
          reason: 'network_error',
          retryAfterMs: wait,
          error: errorMessage(err),
        });
        await this.sleep(wait);
        attempt += 1;
        continue;
      }

      // HTTP rate limit → respektiere Retry-After-Header, Fallback Backoff.
      if (res.status === 429) {
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `Slack ${method} rate limit (HTTP 429) nach ${attempt + 1} Versuchen erschöpft`,
          );
        }
        const wait = parseRetryAfterMs(res.headers.get('retry-after')) ?? this.delayMs(attempt);
        this.onRetry({
          method,
          attempt,
          reason: 'http_429',
          status: 429,
          retryAfterMs: wait,
        });
        await this.sleep(wait);
        attempt += 1;
        continue;
      }

      // 5xx → server-side, transient. Retry mit Backoff.
      if (res.status >= 500 && res.status < 600) {
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `Slack ${method} HTTP ${res.status} nach ${attempt + 1} Versuchen: ${await safeText(res)}`,
          );
        }
        const wait = this.delayMs(attempt);
        this.onRetry({
          method,
          attempt,
          reason: 'http_5xx',
          status: res.status,
          retryAfterMs: wait,
        });
        await this.sleep(wait);
        attempt += 1;
        continue;
      }

      // 4xx (außer 429): auth/permission/scope-Fehler. Retry hilft nicht.
      if (!res.ok) {
        throw new Error(`Slack ${method} HTTP ${res.status}: ${await safeText(res)}`);
      }

      const json = (await res.json()) as { ok?: boolean; error?: string } & T;

      // Slack-soft-rate-limit: HTTP 200, aber `ok: false, error: 'ratelimited'`
      // mit `Retry-After`-Header. Behandeln wir wie HTTP 429.
      if (json.ok === false && json.error === 'ratelimited') {
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `Slack ${method} rate limit (soft) nach ${attempt + 1} Versuchen erschöpft`,
          );
        }
        const wait = parseRetryAfterMs(res.headers.get('retry-after')) ?? this.delayMs(attempt);
        this.onRetry({
          method,
          attempt,
          reason: 'slack_ratelimited',
          retryAfterMs: wait,
        });
        await this.sleep(wait);
        attempt += 1;
        continue;
      }

      if (json.ok === false) {
        throw new Error(`Slack ${method} returned not-ok: ${json.error ?? 'unknown'}`);
      }

      return json;
    }
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

// ── Slack-API-Response-Schemas (locker, nur was wir lesen) ─────────────────

const ApiChannel = z.object({
  id: z.string(),
  name: z.string(),
  name_normalized: z.string().optional(),
  is_private: z.boolean().optional(),
  is_im: z.boolean().optional(),
  is_mpim: z.boolean().optional(),
  topic: z.object({ value: z.string() }).optional(),
  purpose: z.object({ value: z.string() }).optional(),
});
type ApiChannel = z.infer<typeof ApiChannel>;

const ApiUser = z.object({
  id: z.string(),
  name: z.string().optional(),
  real_name: z.string().optional(),
  is_bot: z.boolean().optional(),
  profile: z
    .object({
      display_name: z.string().optional(),
      real_name: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
});
type ApiUser = z.infer<typeof ApiUser>;

const ApiReaction = z.object({
  name: z.string(),
  count: z.number(),
  users: z.array(z.string()).default([]),
});

const ApiMessage = z.object({
  type: z.string().optional(),
  subtype: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  text: z.string().default(''),
  ts: z.string(),
  thread_ts: z.string().optional(),
  reply_count: z.number().optional(),
  reactions: z.array(ApiReaction).optional(),
});
type ApiMessage = z.infer<typeof ApiMessage>;

const HistoryResponse = z.object({
  messages: z.array(ApiMessage).default([]),
  has_more: z.boolean().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

const RepliesResponse = z.object({
  messages: z.array(ApiMessage).default([]),
  has_more: z.boolean().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

const MembersResponse = z.object({
  members: z.array(z.string()).default([]),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

const ChannelInfoResponse = z.object({ channel: ApiChannel });
const UserInfoResponse = z.object({ user: ApiUser });

// ── Snapshot-Aufbau ────────────────────────────────────────────────────────

async function buildSnapshot(
  client: SlackWebClient,
  channelId: string,
  oldest: string | undefined,
): Promise<unknown> {
  const channelInfo = ChannelInfoResponse.parse(
    await client.get('conversations.info', { channel: channelId }),
  );
  const memberIds = await fetchAllMembers(client, channelId);
  const users = await Promise.all(
    memberIds.map(
      async (id) => UserInfoResponse.parse(await client.get('users.info', { user: id })).user,
    ),
  );
  const topLevel = await fetchAllHistory(client, channelId, oldest);

  // Per Top-Level-Message mit Reply-Count > 0 die Thread-Replies nachladen.
  // Slack liefert in `conversations.replies` die Top-Level-Message als ersten
  // Eintrag mit zurück — wir filtern sie raus, weil sie schon als Top-Level
  // im Snapshot steht.
  const enriched: SlackChatMessage[] = [];
  for (const m of topLevel) {
    const mapped = mapMessage(m, /*isReply=*/ false);
    if (!mapped) continue;
    if ((m.reply_count ?? 0) > 0) {
      const replies = await fetchAllReplies(client, channelId, m.ts);
      const replyMessages = replies
        .filter((r) => r.ts !== m.ts)
        .map((r) => mapMessage(r, /*isReply=*/ true))
        .filter((r): r is SlackChatMessage => r !== null);
      mapped.thread = {
        id: `thread_${m.ts}`,
        root_message_id: m.ts,
        reply_count: m.reply_count ?? replyMessages.length,
        messages: replyMessages,
      };
    }
    enriched.push(mapped);
  }

  return {
    channel: mapChannel(channelInfo.channel),
    participants: users.map((u) => mapUser(u)).filter((u) => u.id !== ''),
    content: enriched,
  };
}

async function fetchAllMembers(client: SlackWebClient, channelId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const resp = MembersResponse.parse(
      await client.get('conversations.members', { channel: channelId, cursor, limit: '200' }),
    );
    out.push(...resp.members);
    cursor = nonEmpty(resp.response_metadata?.next_cursor);
  } while (cursor);
  return out;
}

async function fetchAllHistory(
  client: SlackWebClient,
  channelId: string,
  oldest: string | undefined,
): Promise<ApiMessage[]> {
  const out: ApiMessage[] = [];
  let cursor: string | undefined;
  do {
    const resp = HistoryResponse.parse(
      await client.get('conversations.history', {
        channel: channelId,
        cursor,
        limit: '200',
        oldest,
      }),
    );
    out.push(...resp.messages);
    cursor = nonEmpty(resp.response_metadata?.next_cursor);
  } while (cursor);
  // Slack liefert history neueste-zuerst; für deterministische occurred_at-
  // Reihenfolge im Mapper drehen wir um.
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}

async function fetchAllReplies(
  client: SlackWebClient,
  channelId: string,
  threadTs: string,
): Promise<ApiMessage[]> {
  const out: ApiMessage[] = [];
  let cursor: string | undefined;
  do {
    const resp = RepliesResponse.parse(
      await client.get('conversations.replies', {
        channel: channelId,
        ts: threadTs,
        cursor,
        limit: '200',
      }),
    );
    out.push(...resp.messages);
    cursor = nonEmpty(resp.response_metadata?.next_cursor);
  } while (cursor);
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}

function nonEmpty(s: string | undefined): string | undefined {
  return s && s.length > 0 ? s : undefined;
}

// ── API-Shape → SlackSnapshot-Schema ───────────────────────────────────────

function mapChannel(c: ApiChannel): unknown {
  const display = `#${c.name}`;
  const type = c.is_im
    ? 'im'
    : c.is_mpim
      ? 'mpim'
      : c.is_private
        ? 'private_channel'
        : 'public_channel';
  const topic = c.topic?.value ? c.topic.value : undefined;
  const purpose = c.purpose?.value ? c.purpose.value : undefined;
  return {
    id: c.id,
    name: c.name,
    display_name: display,
    type,
    ...(topic !== undefined ? { topic } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
  };
}

function mapUser(u: ApiUser): {
  id: string;
  display_name: string;
  real_name: string;
  role_hint?: string;
} {
  const display = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id;
  const real = u.profile?.real_name || u.real_name || display;
  const role = u.profile?.title;
  return {
    id: u.id,
    display_name: display,
    real_name: real,
    ...(role ? { role_hint: role } : {}),
  };
}

/**
 * Wandelt eine Slack-API-Message in das Snapshot-Schema. Filtert Subtypes und
 * Bot-Messages, weil unser Schema einen `author.id` erwartet und der Mapper
 * pro Message strukturelle Edges zu einem User-Record schreibt — Bot-IDs
 * sind keine User.
 */
function mapMessage(m: ApiMessage, isReply: boolean): SlackChatMessage | null {
  if (m.subtype !== undefined && m.subtype !== 'thread_broadcast') return null;
  if (!m.user) return null;
  return {
    type: isReply ? 'thread_reply' : 'chat_message',
    id: m.ts,
    slack_ts: m.ts,
    datetime: tsToIso(m.ts),
    author: { id: m.user, display_name: m.user },
    text: m.text,
    mentions: extractMentions(m.text),
    reactions: (m.reactions ?? []).map((r) => ({
      name: r.name,
      count: r.count,
      users: r.users,
    })),
  };
}

/** Slack-Timestamp ("1745835810.000100") → ISO-8601 in UTC. */
function tsToIso(ts: string): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) {
    throw new Error(`Ungültiger Slack-Timestamp: ${ts}`);
  }
  return new Date(seconds * 1000).toISOString();
}

/**
 * `<@UABC123>`-Patterns aus dem Body in eine flache Liste extrahieren. Der
 * Mapper trägt das Feld in den Record-Payload, der Mention-Extractor (Z7)
 * ergänzt später Cross-Source-Patterns.
 */
function extractMentions(text: string): string[] {
  const out: string[] = [];
  const re = /<@([UW][A-Z0-9]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}
