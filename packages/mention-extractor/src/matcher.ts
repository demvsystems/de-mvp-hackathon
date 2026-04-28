import type { MentionMatch, MentionPattern } from './patterns/types';

/**
 * Scant einen Body sequentiell durch alle Patterns. Die Patterns laufen in
 * Übergabe-Reihenfolge — die `ALL_PATTERNS`-Registry ist nach Spezifität
 * sortiert, sodass spezifischere Patterns zuerst greifen. Span-Tracking
 * verhindert, dass nachfolgende Patterns auf Substrings bereits gematchter
 * Bereiche treffen.
 *
 * Liefert `MentionMatch[]` sortiert nach Offset im Body — damit Edges in
 * derselben Cascade chronologisch erkennbar bleiben.
 */
export function findMentions(body: string, patterns: readonly MentionPattern[]): MentionMatch[] {
  const matches: MentionMatch[] = [];
  const consumed: Array<[number, number]> = [];

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern.regex)) {
      const start = match.index ?? -1;
      if (start < 0) continue;
      const end = start + match[0].length;

      // Überlappung mit bereits konsumierten Bereichen verwerfen — spezifischeres
      // Pattern hat schon gematched.
      if (consumed.some(([s, e]) => start < e && end > s)) continue;

      matches.push({
        patternName: pattern.name,
        confidence: pattern.confidence,
        matchText: match[0],
        matchStart: start,
        matchEnd: end,
        matchGroups: Array.from(match),
      });
      consumed.push([start, end]);
    }
  }

  // Stabile Reihenfolge nach Body-Position. matchAll liefert pro Pattern
  // zwar geordnet, aber sequentielles Pattern-Iterieren kann später-Body-
  // Matches früher-Body-Matches voranstellen.
  matches.sort((a, b) => a.matchStart - b.matchStart);
  return matches;
}
