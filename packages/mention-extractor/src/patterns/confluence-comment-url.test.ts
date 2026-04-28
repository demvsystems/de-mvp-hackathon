import { describe, expect, it } from 'vitest';
import { confluenceCommentUrlPattern } from './confluence-comment-url';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(confluenceCommentUrlPattern.regex));
}

describe('confluenceCommentUrlPattern', () => {
  it('matcht eine Comment-URL', () => {
    const matches = findMatches('/wiki/spaces/ENG/pages/12345#comment-67');
    expect(matches).toHaveLength(1);
    expect(matches[0]![1]).toBe('67');
  });

  it('matcht nicht ohne comment-Anker', () => {
    expect(findMatches('/wiki/spaces/ENG/pages/12345')).toHaveLength(0);
  });

  it('baut die kanonische Target-ID aus der Comment-Nummer', async () => {
    const matches = findMatches('/wiki/spaces/ENG/pages/12345#comment-67');
    const result = await confluenceCommentUrlPattern.buildTargetId(matches[0]!);
    expect(result).toBe('confluence:comment:67');
  });
});
