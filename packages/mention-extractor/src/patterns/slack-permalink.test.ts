import { describe, expect, it } from 'vitest';
import { slackPermalinkPattern } from './slack-permalink';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(slackPermalinkPattern.regex));
}

describe('slackPermalinkPattern', () => {
  it('matcht eine klassische Slack-Permalink-URL', () => {
    const body = 'Siehe https://demv.slack.com/archives/C02DEF/p1714028591012345';
    const matches = findMatches(body);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('https://demv.slack.com/archives/C02DEF/p1714028591012345');
  });

  it('extrahiert channel und ts-compact aus den Match-Gruppen', () => {
    const body = 'https://workspace.slack.com/archives/C123ABC/p1714028591012345';
    const matches = findMatches(body);
    const m = matches[0]!;
    expect(m[1]).toBe('C123ABC');
    expect(m[2]).toBe('1714028591012345');
  });

  it('matcht Group-Channels (G-Prefix)', () => {
    const matches = findMatches('https://demv.slack.com/archives/G123XYZ/p1714028591012345');
    expect(matches).toHaveLength(1);
  });

  it('liefert null im Pilot ohne Resolver', async () => {
    const matches = findMatches('https://demv.slack.com/archives/C02DEF/p1714028591012345');
    const result = await slackPermalinkPattern.buildTargetId(matches[0]!);
    expect(result).toBeNull();
  });
});
