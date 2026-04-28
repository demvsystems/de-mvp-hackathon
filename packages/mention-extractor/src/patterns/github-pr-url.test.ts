import { describe, expect, it } from 'vitest';
import { githubPrUrlPattern } from './github-pr-url';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(githubPrUrlPattern.regex));
}

describe('githubPrUrlPattern', () => {
  it('matcht eine vollständige PR-URL', () => {
    const matches = findMatches('Bitte review: https://github.com/foo/bar/pull/123');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('https://github.com/foo/bar/pull/123');
  });

  it('matcht keine Issue-URLs', () => {
    expect(findMatches('https://github.com/foo/bar/issues/1')).toHaveLength(0);
  });

  it('baut die kanonische Target-ID', async () => {
    const matches = findMatches('https://github.com/foo/bar/pull/123');
    const result = await githubPrUrlPattern.buildTargetId(matches[0]!);
    expect(result).toBe('github:pr:foo/bar/123');
  });
});
