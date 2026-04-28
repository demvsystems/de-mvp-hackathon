/**
 * Resolver-Schicht: bildet Pattern-Match-Daten auf kanonische subject_ids
 * im Read-Model ab. Im Pilot zwei Resolver-Funktionen:
 *
 * - `resolveJiraKey`: Jira-Key → `jira:issue:<key>` per Records-Tabellen-
 *   Lookup. Liefert null, wenn das Issue noch nicht ingestiert ist.
 * - `resolveSlackPermalink`: (channel, ts) aus URL → `slack:msg:<workspace>/
 *   <channel>/<ts>` per channel-Record-Lookup (workspace lebt im channel-
 *   subject_id-Prefix).
 *
 * DB-Zugriff läuft über injizierte `ResolverDeps` — Tests übergeben Mocks,
 * Production-Code nutzt einen Adapter um das echte `@repo/db sql`.
 */

export interface ResolverDeps {
  /** Sucht ein Jira-Issue über seinen Key. */
  queryJiraIssueByKey(key: string): Promise<{ id: string } | null>;
  /** Sucht einen Slack-Channel-Record über die rohe Channel-ID. */
  queryChannelById(channel: string): Promise<{ id: string } | null>;
}

export async function resolveJiraKey(key: string, deps: ResolverDeps): Promise<string | null> {
  const result = await deps.queryJiraIssueByKey(key);
  return result?.id ?? null;
}

export async function resolveSlackPermalink(
  channel: string,
  tsCompact: string,
  deps: ResolverDeps,
): Promise<string | null> {
  const channelRecord = await deps.queryChannelById(channel);
  if (!channelRecord) return null;

  // subject_id-Format: `slack:channel:<workspace>/<channelRawId>`. Workspace
  // extrahieren — fehlt das Slash-Segment, ist die ID nicht in der erwarteten
  // Struktur und wir geben null zurück (statt eine kaputte ID zu bauen).
  const m = /^slack:channel:([^/]+)\/[^/]+$/.exec(channelRecord.id);
  if (!m) return null;
  const workspace = m[1]!;

  // Slack-Permalink-ts hat keinen Punkt; subject_id-ts mit Punkt nach den
  // ersten 10 Ziffern.
  const ts =
    tsCompact.length >= 10 ? `${tsCompact.slice(0, 10)}.${tsCompact.slice(10)}` : tsCompact;

  return `slack:msg:${workspace}/${channel}/${ts}`;
}
