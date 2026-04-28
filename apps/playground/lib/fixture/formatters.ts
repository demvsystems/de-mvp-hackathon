import {
  createSeededRandom,
  dummyEmail,
  dummyUrl,
  pickOne,
  replaceUnsafeDomainsInString,
  type GeneratorContext,
  type RandomFn,
} from './generator-utils';

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const ISSUE_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Done'] as const;
const CONVERSATION_STATES = ['open', 'pending', 'closed'] as const;
const SENTIMENT_TEXT: Record<string, string> = {
  neutral: 'neutral tone',
  frustrated: 'frustrated tone',
  positive: 'positive tone',
  negative: 'negative tone',
};

function isoAtOffset(base: Date, hoursOffset: number): string {
  return new Date(base.getTime() + hoursOffset * 60 * 60 * 1000).toISOString();
}

function mutateString(
  key: string,
  value: string,
  ctx: GeneratorContext,
  index: number,
  rng: RandomFn,
): string {
  const lower = key.toLowerCase();
  const token = `${ctx.source}-${index + 1}`;

  if (lower.includes('email')) return dummyEmail(token);
  if (lower.includes('url') || lower.includes('domain') || lower.includes('site')) {
    return dummyUrl(token);
  }
  if (lower === 'language' || lower.endsWith('_language')) return ctx.language;
  if (lower.includes('id') && !lower.includes('thread')) return `dummy_${lower}_${index + 1}`;
  if (lower === 'key' || lower.endsWith('_key')) return `DUMMY-${100 + index}`;
  if (lower.includes('status')) {
    return pickOne(rng, ['open', 'in_progress', 'pending', 'resolved']);
  }
  if (lower.includes('priority')) {
    return ctx.severity;
  }
  if (
    lower.includes('title') ||
    lower.includes('summary') ||
    lower.includes('topic') ||
    lower.includes('subject')
  ) {
    return `[DUMMY] ${ctx.topic} (${ctx.category}) #${index + 1}`;
  }
  if (
    lower.includes('description') ||
    lower.includes('body') ||
    lower.includes('text') ||
    lower.includes('purpose') ||
    lower.includes('goal')
  ) {
    return `[DUMMY][${ctx.product}] ${ctx.topic} - ${SENTIMENT_TEXT[ctx.sentiment] ?? 'neutral tone'} - detail:${ctx.detailLevel}`;
  }
  if (lower.includes('name')) return `Dummy User ${index + 1}`;
  if (lower.includes('tag')) return `dummy-${ctx.category}`;
  return replaceUnsafeDomainsInString(value);
}

function mutateNode(
  node: unknown,
  ctx: GeneratorContext,
  index: number,
  rng: RandomFn,
  keyHint?: string,
  baseDate?: Date,
): unknown {
  if (typeof node === 'string') {
    if (keyHint && keyHint.toLowerCase().includes('ts')) {
      return String(1770000000 + index * 10);
    }
    if (
      keyHint &&
      ['created_at', 'updated_at', 'closed_at', 'datetime', 'startdate', 'enddate'].some((token) =>
        keyHint.toLowerCase().includes(token),
      )
    ) {
      return isoAtOffset(baseDate ?? new Date(), index);
    }
    return mutateString(keyHint ?? '', node, ctx, index, rng);
  }
  if (typeof node === 'number') {
    if (keyHint?.toLowerCase().includes('count') || keyHint?.toLowerCase().includes('size')) {
      return Math.max(1, Math.round(node + rng() * 3));
    }
    if (keyHint?.toLowerCase().includes('id')) return 1000 + index;
    return node;
  }
  if (typeof node === 'boolean' || node === null) return node;
  if (Array.isArray(node)) {
    if (node.length === 0) {
      return [];
    }
    return node.map((entry, subIndex) =>
      mutateNode(entry, ctx, index + subIndex, rng, keyHint, baseDate),
    );
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = mutateNode(value, ctx, index, rng, key, baseDate);
    }
    return out;
  }
  return node;
}

function withBaseMutations(
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  const rng = createSeededRandom(`${ctx.source}|${ctx.topic}|${index}`);
  const baseDate = new Date(Date.UTC(2026, 0, 1, 9, 0, 0));
  return mutateNode(template, ctx, index, rng, undefined, baseDate) as Record<string, unknown>;
}

export function formatJiraResponse(
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  const output = withBaseMutations(template, ctx, index);
  const issues = output['issues'];
  if (Array.isArray(issues)) {
    for (let i = 0; i < issues.length; i += 1) {
      const issue = issues[i];
      if (issue && typeof issue === 'object' && !Array.isArray(issue)) {
        const obj = issue as Record<string, unknown>;
        obj['key'] = `DUMMY-${100 + index + i}`;
        obj['status'] = ISSUE_STATUSES[(index + i) % ISSUE_STATUSES.length];
        obj['priority'] = PRIORITIES[(index + i) % PRIORITIES.length];
      }
    }
  }
  return output;
}

export function formatSlackResponse(
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  const output = withBaseMutations(template, ctx, index);
  const defaultTeamId = 'DE-MVP';
  const reactionNames = ['eyes', 'white_check_mark', 'rocket', 'thumbsup'] as const;

  const channel = output['channel'];
  if (channel && typeof channel === 'object' && !Array.isArray(channel)) {
    const ch = channel as Record<string, unknown>;
    if (typeof ch['team_id'] !== 'string' || ch['team_id'].trim().length === 0) {
      ch['team_id'] = defaultTeamId;
    }
  }

  const participants = output['participants'];
  if (Array.isArray(participants)) {
    for (const participant of participants) {
      if (participant && typeof participant === 'object' && !Array.isArray(participant)) {
        const p = participant as Record<string, unknown>;
        if (typeof p['team_id'] !== 'string' || p['team_id'].trim().length === 0) {
          p['team_id'] = defaultTeamId;
        }
      }
    }
  }

  function ensureReactions(message: Record<string, unknown>, seedOffset: number): void {
    const existing = message['reactions'];
    if (Array.isArray(existing)) {
      return;
    }
    const name = reactionNames[(index + seedOffset) % reactionNames.length];
    message['reactions'] = [
      {
        name,
        count: 1 + ((index + seedOffset) % 3),
        users: ['U_DUMMY_001'],
      },
    ];
  }

  const content = output['content'];
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i += 1) {
      const item = content[i];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const msg = item as Record<string, unknown>;
        if (typeof msg['team_id'] !== 'string' || msg['team_id'].trim().length === 0) {
          msg['team_id'] = defaultTeamId;
        }
        msg['id'] = `msg_dummy_${index + 1}_${i + 1}`;
        msg['text'] = `[DUMMY][${ctx.product}] ${ctx.topic} (${ctx.sentiment})`;
        ensureReactions(msg, i);

        const thread = msg['thread'];
        if (thread && typeof thread === 'object' && !Array.isArray(thread)) {
          const threadMessages = (thread as Record<string, unknown>)['messages'];
          if (Array.isArray(threadMessages)) {
            for (let j = 0; j < threadMessages.length; j += 1) {
              const reply = threadMessages[j];
              if (reply && typeof reply === 'object' && !Array.isArray(reply)) {
                const replyObj = reply as Record<string, unknown>;
                if (
                  typeof replyObj['team_id'] !== 'string' ||
                  replyObj['team_id'].trim().length === 0
                ) {
                  replyObj['team_id'] = defaultTeamId;
                }
                ensureReactions(replyObj, i + j + 1);
              }
            }
          }
        }
      }
    }
  }
  return output;
}

export function formatUpvotyResponse(
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  const output = withBaseMutations(template, ctx, index);
  const posts = output['posts'];
  if (Array.isArray(posts)) {
    for (let i = 0; i < posts.length; i += 1) {
      const post = posts[i];
      if (post && typeof post === 'object' && !Array.isArray(post)) {
        const obj = post as Record<string, unknown>;
        obj['title'] = `[DUMMY] ${ctx.topic} #${index + i + 1}`;
        obj['status'] = 'open';
      }
    }
  }
  return output;
}

export function formatIntercomResponse(
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  const output = withBaseMutations(template, ctx, index);
  for (const value of Object.values(output)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const eventObj = value as Record<string, unknown>;
      const data = eventObj['data'];
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const item = (data as Record<string, unknown>)['item'];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const itemObj = item as Record<string, unknown>;
          itemObj['state'] = CONVERSATION_STATES[index % CONVERSATION_STATES.length];
        }
      }
    }
  }
  return output;
}
