import {
  EdgeObserved,
  publish as defaultPublish,
  type EdgeObservedPayload,
  type EventDefinition,
  type MessageContext,
  type PublishAck,
  type PublishInput,
  type RecordPayload,
} from '@repo/messaging';
import { buildMentionEdge } from './emit';
import { findMentions } from './matcher';
import { ALL_PATTERNS, type MentionMatch } from './patterns';
import { PendingMentions } from './pending';
import { resolveJiraKey, resolveSlackPermalink, type ResolverDeps } from './resolver';

const SKIP_TYPES = new Set(['channel', 'repo', 'project', 'database', 'space', 'user']);

/** Signatur des publishers, lockerer als der echte Generic — Tests können ihn mocken. */
export type PublishFn = <T>(
  event: EventDefinition<T>,
  input: PublishInput<T>,
) => Promise<PublishAck>;

/**
 * Versucht, für einen Match eine Target-ID zu bauen. Drei Wege:
 * 1. Pattern.buildTargetId direkt (URL-Patterns mit ID aus Match-Gruppen).
 * 2. Resolver-DB-Lookup (jira-key, jira-hashtag → resolveJiraKey).
 * 3. Resolver mit Workspace-Lookup (slack-permalink → resolveSlackPermalink).
 *
 * Liefert null, wenn das Target (noch) nicht da ist.
 */
async function resolveTargetId(match: MentionMatch, deps: ResolverDeps): Promise<string | null> {
  const pattern = ALL_PATTERNS.find((p) => p.name === match.patternName);
  if (!pattern) return null;

  // Patterns wie github_*_url bauen direkt aus match-groups eine ID. Der Cast
  // auf RegExpMatchArray ist sicher, weil das Pattern nur die String-Indizes
  // anfasst, die `Array.from(match)` faithfully kopiert.
  const built = await pattern.buildTargetId(match.matchGroups as unknown as RegExpMatchArray);
  if (built !== null) return built;

  if (match.patternName === 'jira_key' || match.patternName === 'jira_hashtag') {
    const key = `${match.matchGroups[1]}-${match.matchGroups[2]}`;
    return resolveJiraKey(key, deps);
  }
  if (match.patternName === 'slack_permalink') {
    return resolveSlackPermalink(match.matchGroups[1]!, match.matchGroups[2]!, deps);
  }
  return null;
}

/**
 * Verarbeitet ein einzelnes record-event. Container und Records ohne Body
 * werden übersprungen. Pro Match: Auflösen oder in pending stapeln. Edges
 * werden mit dem injizierten publish-Aufruf gepusht.
 */
export async function processRecord(
  payload: RecordPayload,
  ctx: MessageContext,
  deps: ResolverDeps,
  pending: PendingMentions,
  publishFn: PublishFn,
): Promise<void> {
  if (SKIP_TYPES.has(payload.type)) return;
  if (!payload.body) return;

  const matches = findMentions(payload.body, ALL_PATTERNS);
  for (const match of matches) {
    const targetId = await resolveTargetId(match, deps);
    if (targetId !== null) {
      await publishFn(EdgeObserved, buildMentionEdge(payload, match, targetId, ctx));
      continue;
    }
    // Pending-Pfad nur für jira-Patterns: hier kennen wir den Key-String,
    // an dem das Late-Binding hängt. slack-permalink hat keinen analogen
    // pending-Pfad im Pilot — wenn der Channel fehlt, entgeht uns die
    // Mention bei diesem Run; ein Replay nach Channel-Ingest greift sie.
    if (match.patternName === 'jira_key' || match.patternName === 'jira_hashtag') {
      const key = `${match.matchGroups[1]}-${match.matchGroups[2]}`;
      pending.addJiraKey(key, payload.id, match);
    }
  }
}

/**
 * Bei jedem neu ingestierten jira-issue-Record: pending-Slot drainen und
 * Edges nachträglich publishen. causation/correlation auf das jira-issue-
 * Event, weil das jetzt der unmittelbare Auslöser der Edge-Erzeugung ist.
 */
export async function processNewJiraIssue(
  payload: RecordPayload,
  ctx: MessageContext,
  pending: PendingMentions,
  publishFn: PublishFn,
): Promise<void> {
  if (payload.source !== 'jira' || payload.type !== 'issue') return;
  const key = (payload.payload as { key?: string }).key;
  if (!key) return;

  const resolved = pending.resolveJiraKey(key, payload.id);
  if (resolved.length === 0) return;

  for (const entry of resolved) {
    // Wir bauen ein synthetisches RecordPayload mit der korrekten id, damit
    // buildMentionEdge `from_id` korrekt setzt. Das ist nicht das echte
    // Source-Record (das haben wir nicht mehr im Speicher), aber für die
    // Edge-Felder ausreichend.
    const fakeFrom: RecordPayload = {
      id: entry.fromRecordId,
      type: 'message',
      source: entry.fromRecordId.split(':')[0] ?? 'unknown',
      title: null,
      body: null,
      payload: {},
      created_at: ctx.envelope.occurred_at,
      updated_at: ctx.envelope.occurred_at,
    };
    await publishFn(EdgeObserved, buildMentionEdge(fakeFrom, entry.match, entry.targetId, ctx));
  }
}

/** Default-Publisher: nutzt den echten messaging-Publisher. */
export const defaultPublishFn: PublishFn = (event, input) =>
  defaultPublish(
    event as EventDefinition<unknown>,
    input as PublishInput<unknown>,
  ) as Promise<PublishAck>;

export type _UnusedEdgeObservedPayload = EdgeObservedPayload; // ensure import keeps for type re-export
