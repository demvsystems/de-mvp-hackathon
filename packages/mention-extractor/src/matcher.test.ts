import { describe, expect, it } from 'vitest';
import { findMentions } from './matcher';
import { ALL_PATTERNS } from './patterns';

describe('findMentions', () => {
  it('findet einen einzelnen jira-key', () => {
    const matches = findMentions('Bitte zu DEMV-4127 gucken.', ALL_PATTERNS);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.patternName).toBe('jira_key');
    expect(matches[0]!.matchText).toBe('DEMV-4127');
  });

  it('findet mehrere unabhängige Patterns im selben Body', () => {
    const body = 'Siehe https://github.com/foo/bar/pull/12 zu PRICE-7.';
    const matches = findMentions(body, ALL_PATTERNS);
    const names = matches.map((m) => m.patternName).sort();
    expect(names).toEqual(['github_pr_url', 'jira_key']);
  });

  it('Konfusionsfreiheit: Confluence-Comment-URL überschreibt nicht durch Page-URL', () => {
    // Page-URL ist Substring von Comment-URL. Comment-URL ist spezifischer und
    // wird zuerst gematched; Span-Tracking verhindert zweiten Page-Match.
    const body = '/wiki/spaces/ENG/pages/12345#comment-67';
    const matches = findMentions(body, ALL_PATTERNS);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.patternName).toBe('confluence_comment_url');
  });

  it('Konfusionsfreiheit: Slack-Permalink wird nicht durch jira-key-Substring konfundiert', () => {
    // Eine vollständige Slack-Permalink-URL kann eine workspace-Subdomain enthalten,
    // die wie ein Jira-Key aussehen könnte (THEORETISCH). Hier prüfen wir, dass
    // die URL als Permalink erkannt wird und keine Sekundär-Edges erzeugt.
    const body = 'https://demv.slack.com/archives/C02DEF/p1714028591012345';
    const matches = findMentions(body, ALL_PATTERNS);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.patternName).toBe('slack_permalink');
  });

  it('liefert die Matches in stabiler Reihenfolge (nach Offset im Body)', () => {
    const body =
      'PRICE-7 zu Beginn, https://github.com/foo/bar/pull/12 in der Mitte, DEMV-4127 am Ende.';
    const matches = findMentions(body, ALL_PATTERNS);
    expect(matches.map((m) => m.matchText)).toEqual([
      'PRICE-7',
      'https://github.com/foo/bar/pull/12',
      'DEMV-4127',
    ]);
  });

  it('liefert leeres Array bei Body ohne Treffer', () => {
    expect(findMentions('einfacher text ohne mentions', ALL_PATTERNS)).toEqual([]);
  });

  it('extrahiert match-Offsets und match-Text korrekt', () => {
    const body = 'foo DEMV-4127 bar';
    const matches = findMentions(body, ALL_PATTERNS);
    expect(matches[0]!.matchStart).toBe(4);
    expect(matches[0]!.matchEnd).toBe(13);
    expect(matches[0]!.matchText).toBe('DEMV-4127');
  });

  it('jira_hashtag und jira_key konfundieren nicht — der Hashtag-Match deckt den Key-Substring ab', () => {
    const body = '#DEMV-4127 ist offen.';
    const matches = findMentions(body, ALL_PATTERNS);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.patternName).toBe('jira_hashtag');
  });
});

describe('ALL_PATTERNS Registry', () => {
  it('enthält alle erwarteten Patterns', () => {
    const names = ALL_PATTERNS.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        'confluence_comment_url',
        'confluence_page_url',
        'github_issue_shortform',
        'github_issue_url',
        'github_pr_url',
        'jira_hashtag',
        'jira_key',
        'slack_permalink',
      ].sort(),
    );
  });

  it('ist nach Spezifität sortiert: URLs zuerst, freie Keys zuletzt', () => {
    // Ein Pattern A ist spezifischer als B, wenn As Match strictly enger ist
    // als Bs Match auf demselben Substring. Konkret: confluence_comment_url
    // (mit #comment-anchor) muss vor confluence_page_url stehen.
    const positions = new Map<string, number>();
    ALL_PATTERNS.forEach((p, i) => positions.set(p.name, i));
    expect(positions.get('confluence_comment_url')!).toBeLessThan(
      positions.get('confluence_page_url')!,
    );
    expect(positions.get('jira_hashtag')!).toBeLessThan(positions.get('jira_key')!);
    // URL-Patterns sollten vor freien Patterns stehen (jira_key, jira_hashtag).
    expect(positions.get('github_issue_url')!).toBeLessThan(positions.get('jira_key')!);
    expect(positions.get('slack_permalink')!).toBeLessThan(positions.get('jira_key')!);
  });
});
