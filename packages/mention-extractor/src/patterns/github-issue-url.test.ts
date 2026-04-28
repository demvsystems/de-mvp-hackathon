import { describe, expect, it } from 'vitest';
import { githubIssueUrlPattern } from './github-issue-url';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(githubIssueUrlPattern.regex));
}

describe('githubIssueUrlPattern', () => {
  it('matcht eine vollständige GitHub-Issue-URL', () => {
    const body = 'Siehe https://github.com/onboardflow/api/issues/38 für Kontext.';
    const matches = findMatches(body);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('https://github.com/onboardflow/api/issues/38');
  });

  it('matcht keine PR-URLs (eigenes Pattern)', () => {
    const body = 'PR: https://github.com/foo/bar/pull/12';
    expect(findMatches(body)).toHaveLength(0);
  });

  it('matcht mehrere Issue-URLs', () => {
    const body = 'a https://github.com/a/b/issues/1 und b https://github.com/c/d/issues/2';
    const matches = findMatches(body);
    expect(matches.map((m) => m[0])).toEqual([
      'https://github.com/a/b/issues/1',
      'https://github.com/c/d/issues/2',
    ]);
  });

  it('baut die kanonische Target-ID aus owner/repo/number', async () => {
    const matches = findMatches('https://github.com/onboardflow/api/issues/38');
    const result = await githubIssueUrlPattern.buildTargetId(matches[0]!);
    expect(result).toBe('github:issue:onboardflow/api/38');
  });
});
