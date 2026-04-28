import { describe, expect, it } from 'vitest';
import { githubIssueShortformPattern } from './github-issue-shortform';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(githubIssueShortformPattern.regex));
}

describe('githubIssueShortformPattern', () => {
  it('matcht owner/repo#number', () => {
    const matches = findMatches('Same as foo/bar#42');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('foo/bar#42');
  });

  it('matcht keine Repo-Pfade ohne Issue-Anker', () => {
    expect(findMatches('foo/bar')).toHaveLength(0);
    expect(findMatches('a/b/c')).toHaveLength(0);
  });

  it('matcht keine bare-Hash-Form (#42 allein ist mehrdeutig)', () => {
    expect(findMatches('See #42 for details')).toHaveLength(0);
  });

  it('akzeptiert Punkte und Bindestriche im Repo-Namen', () => {
    const matches = findMatches('foo.bar/some-thing#7');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('foo.bar/some-thing#7');
  });

  it('baut die kanonische Target-ID', async () => {
    const matches = findMatches('foo/bar#42');
    const result = await githubIssueShortformPattern.buildTargetId(matches[0]!);
    expect(result).toBe('github:issue:foo/bar/42');
  });
});
