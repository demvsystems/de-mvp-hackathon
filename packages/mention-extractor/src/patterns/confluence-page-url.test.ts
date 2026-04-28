import { describe, expect, it } from 'vitest';
import { confluencePageUrlPattern } from './confluence-page-url';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(confluencePageUrlPattern.regex));
}

describe('confluencePageUrlPattern', () => {
  it('matcht eine Page-URL mit space-key', () => {
    const matches = findMatches('see /wiki/spaces/ENG/pages/12345');
    expect(matches).toHaveLength(1);
    expect(matches[0]![1]).toBe('ENG');
    expect(matches[0]![2]).toBe('12345');
  });

  it('matcht keine Comment-URL (eigenes Pattern, fängt comment-Anker ab)', () => {
    // Page-URL alleine matcht; das Comment-Pattern matched zusätzlich.
    // Span-Tracking im Matcher löst die Konfusion auf — hier prüfen wir nur,
    // dass das Page-Pattern selbst auch auf die Page-Substring passt.
    const matches = findMatches('/wiki/spaces/ENG/pages/12345#comment-67');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('/wiki/spaces/ENG/pages/12345');
  });

  it('baut die kanonische Target-ID aus der Page-Nummer', async () => {
    const matches = findMatches('/wiki/spaces/ENG/pages/12345');
    const result = await confluencePageUrlPattern.buildTargetId(matches[0]!);
    expect(result).toBe('confluence:page:12345');
  });
});
