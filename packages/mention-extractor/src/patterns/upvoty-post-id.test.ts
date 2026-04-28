import { describe, expect, it } from 'vitest';
import { upvotyPostIdPattern } from './upvoty-post-id';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(upvotyPostIdPattern.regex));
}

describe('upvotyPostIdPattern', () => {
  it('matcht eine Post-ID', () => {
    const matches = findMatches('Außendienst meldet wieder Mobile-Lahmsucht (Upvoty post_2002).');
    expect(matches.map((m) => m[0])).toEqual(['post_2002']);
  });

  it('matcht mehrere Post-IDs im selben Body', () => {
    const matches = findMatches('post_2001 sowie post_2002 + Intercom conv_9003');
    expect(matches.map((m) => m[0])).toEqual(['post_2001', 'post_2002']);
  });

  it('matcht nicht in zusammengesetzten Tokens', () => {
    expect(findMatches('blog_post_2001bar')).toHaveLength(0);
    expect(findMatches('Xpost_2001')).toHaveLength(0);
    expect(findMatches('post_2001abc')).toHaveLength(0);
    // post_image_42 — nach `post_` kommt ein Buchstabe, kein Digit-Match
    expect(findMatches('post_image_42')).toHaveLength(0);
  });

  it('matcht keine Variante ohne Ziffern-Suffix', () => {
    expect(findMatches('post_alpha')).toHaveLength(0);
    expect(findMatches('post_')).toHaveLength(0);
  });

  it('matcht hinter Satzzeichen sauber', () => {
    expect(findMatches('Siehe post_2001.').map((m) => m[0])).toEqual(['post_2001']);
    expect(findMatches('(post_2001)').map((m) => m[0])).toEqual(['post_2001']);
    expect(findMatches('post_2001,').map((m) => m[0])).toEqual(['post_2001']);
  });

  it('baut die kanonische Target-ID', async () => {
    const matches = findMatches('Siehe post_2001');
    const result = await upvotyPostIdPattern.buildTargetId(matches[0]!);
    expect(result).toBe('upvoty:post:post_2001');
  });

  it('hat den erwarteten Namen für Evidence', () => {
    expect(upvotyPostIdPattern.name).toBe('upvoty_post_id');
  });
});
