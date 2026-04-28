export interface TemplateMetadata {
  topLevelFields: string[];
  detectedObjectType: string | null;
  hasUser: boolean;
  hasMessageBody: boolean;
  hasTimestamp: boolean;
}

const USER_KEYWORDS = ['user', 'customer', 'author', 'admin', 'participant', 'contact'];
const MESSAGE_KEYWORDS = ['body', 'text', 'message', 'description', 'summary', 'purpose', 'goal'];
const TIMESTAMP_KEYWORDS = [
  'created_at',
  'updated_at',
  'closed_at',
  'startdate',
  'enddate',
  'datetime',
  'timestamp',
  'ts',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(
  node: unknown,
  visitor: (key: string, value: unknown) => void,
  depth = 0,
  maxDepth = 6,
): void {
  if (depth > maxDepth) return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visitor, depth + 1, maxDepth);
    return;
  }
  if (!isRecord(node)) return;

  for (const [key, value] of Object.entries(node)) {
    visitor(key, value);
    walk(value, visitor, depth + 1, maxDepth);
  }
}

function looksLikeIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}

export function inferDetectedObjectType(template: unknown): string | null {
  if (!isRecord(template)) return null;
  const keys = Object.keys(template).map((k) => k.toLowerCase());

  if (keys.includes('issues')) return 'jira-issue-collection';
  if (keys.includes('content') && keys.includes('channel')) return 'slack-channel-conversation';
  if (keys.includes('conversations') && keys.includes('contacts'))
    return 'intercom-conversation-snapshot';
  if (keys.includes('boards') && keys.includes('posts')) return 'upvoty-feedback-snapshot';
  return null;
}

export function extractTemplateMetadata(template: unknown): TemplateMetadata {
  const topLevelFields = isRecord(template) ? Object.keys(template) : [];

  let hasUser = false;
  let hasMessageBody = false;
  let hasTimestamp = false;

  walk(template, (rawKey, value) => {
    const key = rawKey.toLowerCase();
    if (!hasUser && USER_KEYWORDS.some((keyword) => key.includes(keyword))) {
      hasUser = true;
    }
    if (!hasMessageBody && MESSAGE_KEYWORDS.some((keyword) => key.includes(keyword))) {
      hasMessageBody = true;
    }

    if (!hasTimestamp) {
      if (TIMESTAMP_KEYWORDS.some((keyword) => key.includes(keyword))) {
        hasTimestamp = true;
      } else if (typeof value === 'string' && looksLikeIsoTimestamp(value)) {
        hasTimestamp = true;
      }
    }
  });

  return {
    topLevelFields,
    detectedObjectType: inferDetectedObjectType(template),
    hasUser,
    hasMessageBody,
    hasTimestamp,
  };
}

function truncateValue(value: unknown, maxTextLength: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= maxTextLength) return value;
    return `${value.slice(0, maxTextLength)}...`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((entry) => truncateValue(entry, maxTextLength));
  }
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 8)) {
    out[key] = truncateValue(entry, maxTextLength);
  }
  return out;
}

export function buildTemplatePreview(template: unknown): unknown {
  return truncateValue(template, 180);
}
