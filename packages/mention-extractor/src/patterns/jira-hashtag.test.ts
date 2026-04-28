import { describe, expect, it } from 'vitest';
import { jiraHashtagPattern } from './jira-hashtag';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(jiraHashtagPattern.regex));
}

describe('jiraHashtagPattern', () => {
  it('matcht #PROJECT-NUMBER hashtag-style', () => {
    const matches = findMatches('Discussion zu #DEMV-4127 läuft.');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('#DEMV-4127');
    expect(matches[0]![1]).toBe('DEMV');
    expect(matches[0]![2]).toBe('4127');
  });

  it('matcht keinen klassischen Jira-Key ohne Hash', () => {
    expect(findMatches('SHOP-142 ohne Hash')).toHaveLength(0);
  });

  it('niedrigere Confidence als Standard-Jira-Pattern', () => {
    expect(jiraHashtagPattern.confidence).toBeLessThan(0.95);
  });

  it('liefert null im Pilot ohne Resolver', async () => {
    const matches = findMatches('#DEMV-4127');
    const result = await jiraHashtagPattern.buildTargetId(matches[0]!);
    expect(result).toBeNull();
  });
});
