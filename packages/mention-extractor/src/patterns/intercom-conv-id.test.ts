import { describe, expect, it } from 'vitest';
import { intercomConvIdPattern } from './intercom-conv-id';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(intercomConvIdPattern.regex));
}

describe('intercomConvIdPattern', () => {
  it('matcht eine Conversation-ID in Klammer-Kontext', () => {
    const body = 'Customer demo.user@example.com (Intercom conv_9001) hat exakt das gemeldet.';
    const matches = findMatches(body);
    expect(matches.map((m) => m[0])).toEqual(['conv_9001']);
  });

  it('matcht mehrere Conversation-IDs im selben Body', () => {
    const matches = findMatches('Upvoty post_2001 + Intercom conv_9003 sowie conv_9004');
    expect(matches.map((m) => m[0])).toEqual(['conv_9003', 'conv_9004']);
  });

  it('matcht nicht in zusammengesetzten Tokens', () => {
    expect(findMatches('foo_conv_9001bar')).toHaveLength(0);
    expect(findMatches('Xconv_9001')).toHaveLength(0);
    expect(findMatches('conv_9001abc')).toHaveLength(0);
  });

  it('matcht keine Variante ohne Ziffern-Suffix', () => {
    expect(findMatches('conv_alpha')).toHaveLength(0);
    expect(findMatches('conv_')).toHaveLength(0);
  });

  it('matcht hinter Satzzeichen sauber', () => {
    expect(findMatches('Siehe conv_9001.').map((m) => m[0])).toEqual(['conv_9001']);
    expect(findMatches('Siehe conv_9001,').map((m) => m[0])).toEqual(['conv_9001']);
    expect(findMatches('(conv_9001)').map((m) => m[0])).toEqual(['conv_9001']);
  });

  it('baut die kanonische Target-ID', async () => {
    const matches = findMatches('Siehe conv_9001');
    const result = await intercomConvIdPattern.buildTargetId(matches[0]!);
    expect(result).toBe('intercom:conversation:conv_9001');
  });

  it('hat den erwarteten Namen für Evidence', () => {
    expect(intercomConvIdPattern.name).toBe('intercom_conv_id');
  });
});
