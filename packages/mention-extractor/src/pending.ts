import type { MentionMatch } from './patterns';

/**
 * Liste pending Mentions, die der Resolver beim ersten Versuch nicht
 * auflösen konnte — typisch wenn ein Slack-Body einen Jira-Key erwähnt,
 * dessen Issue noch nicht ingestiert ist.
 *
 * In-Memory als Map<jira-key, Liste<entry>>. Kommt ein neuer Issue an,
 * lookupt der Worker den Key, holt alle pending entries und emittiert
 * die Edges nachträglich. Worker-Restart leert den Speicher; bei Replay
 * werden die Mentions erneut gesehen, sobald die Quelle wieder kommt.
 *
 * Idempotenz auf (fromRecordId, matchStart, matchText) — derselbe Slack-
 * Body mit derselben Mention an derselben Stelle landet nur einmal in
 * pending, auch wenn `record.observed` doppelt feuert.
 */
export interface PendingEntry {
  readonly fromRecordId: string;
  readonly match: MentionMatch;
}

export interface ResolvedEntry extends PendingEntry {
  readonly targetId: string;
}

export class PendingMentions {
  private readonly byJiraKey = new Map<string, PendingEntry[]>();

  size(): number {
    let count = 0;
    for (const list of this.byJiraKey.values()) count += list.length;
    return count;
  }

  addJiraKey(jiraKey: string, fromRecordId: string, match: MentionMatch): void {
    const list = this.byJiraKey.get(jiraKey) ?? [];
    // Idempotenz: gleiche Mention im gleichen Record an gleicher Stelle
    const existing = list.find(
      (e) =>
        e.fromRecordId === fromRecordId &&
        e.match.matchStart === match.matchStart &&
        e.match.matchText === match.matchText,
    );
    if (existing) return;
    list.push({ fromRecordId, match });
    this.byJiraKey.set(jiraKey, list);
  }

  resolveJiraKey(jiraKey: string, targetId: string): ResolvedEntry[] {
    const list = this.byJiraKey.get(jiraKey);
    if (!list || list.length === 0) return [];
    this.byJiraKey.delete(jiraKey);
    return list.map((e) => ({ ...e, targetId }));
  }
}
