import { createHash } from 'node:crypto';

export function deterministicEventId(args: {
  event_type: string;
  source: string;
  subject_id: string;
  occurred_at: string;
  content_hash: string;
}): string {
  const input = `${args.event_type}|${args.source}|${args.subject_id}|${args.occurred_at}|${args.content_hash}`;
  return `evt_${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

export function contentHash(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
