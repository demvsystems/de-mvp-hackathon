const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'bei',
  'das',
  'dem',
  'den',
  'der',
  'des',
  'die',
  'ein',
  'eine',
  'einer',
  'eines',
  'er',
  'es',
  'for',
  'from',
  'hat',
  'have',
  'ihr',
  'im',
  'in',
  'is',
  'ist',
  'it',
  'mit',
  'nicht',
  'no',
  'of',
  'on',
  'or',
  'our',
  'sein',
  'sind',
  'the',
  'their',
  'this',
  'to',
  'und',
  'uns',
  'von',
  'wir',
  'with',
  'zu',
]);

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function tokenize(text: string): string[] {
  return unique(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

export function overlapScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.length === 0) return 1;
  const hits = leftTokens.filter((token) => rightTokens.has(token)).length;
  return hits / leftTokens.length;
}

export function averageBestOverlap(expected: readonly string[], actual: readonly string[]): number {
  if (expected.length === 0) return 1;
  if (actual.length === 0) return 0;

  const scores = expected.map((candidate) =>
    actual.reduce((best, signal) => Math.max(best, overlapScore(candidate, signal)), 0),
  );

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}
