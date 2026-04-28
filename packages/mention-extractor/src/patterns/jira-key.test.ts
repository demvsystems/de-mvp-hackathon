import { describe, expect, it } from 'vitest';
import { jiraKeyPattern } from './jira-key';

function findMatches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(jiraKeyPattern.regex));
}

describe('jiraKeyPattern', () => {
  it('matcht klassische Jira-Keys', () => {
    const body = 'Bitte schau dir DEMV-4127 an.';
    const matches = findMatches(body);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe('DEMV-4127');
  });

  it('matcht mehrere Keys in einem Body', () => {
    const body = 'SHOP-142 hängt mit DEMV-4127 zusammen, blockiert von PRICE-7.';
    const matches = findMatches(body);
    expect(matches.map((m) => m[0])).toEqual(['SHOP-142', 'DEMV-4127', 'PRICE-7']);
  });

  it('matcht nicht innerhalb von Wörtern (Word-Boundary nötig)', () => {
    const body = 'Pfad /api/SHOP-142/details und Variable mySHOP-142var';
    const matches = findMatches(body);
    // /api/SHOP-142 → vor "SHOP" steht "/", das ist Word-Boundary, also matched
    // mySHOP-142var → vor "SHOP" steht "y" (Word-Char), kein Match
    expect(matches.map((m) => m[0])).toEqual(['SHOP-142']);
  });

  it('matcht keine reinen Lower-Case-Strings (verlangt führenden Großbuchstaben)', () => {
    const body = 'shop-142 ist ungültig, aber Shop-142 wäre auch nicht eindeutig';
    const matches = findMatches(body);
    expect(matches).toHaveLength(0);
  });

  it('matcht keinen Key ohne Bindestrich-Nummer', () => {
    expect(findMatches('SHOP allein').length).toBe(0);
    expect(findMatches('SHOP-').length).toBe(0);
    expect(findMatches('SHOP-foo').length).toBe(0);
  });

  it('hat eine plausible Confidence im Spec-Bereich', () => {
    expect(jiraKeyPattern.confidence).toBeGreaterThanOrEqual(0.9);
    expect(jiraKeyPattern.confidence).toBeLessThan(1);
  });

  it('hat einen aussagekräftigen Namen für Evidence', () => {
    expect(jiraKeyPattern.name).toBe('jira_key');
  });

  describe('buildTargetId', () => {
    it('ruft den Resolver mit dem zusammengesetzten Key auf', async () => {
      const matches = findMatches('Bitte zu DEMV-4127');
      const match = matches[0]!;
      // Im Pilot ohne Resolver-Injection liefert das Pattern `null` zurück,
      // weil keine DB-Lookup-Funktion verbunden ist. Der Worker übergibt
      // später eine echte Resolver-Funktion via Pattern-Factory.
      const result = await jiraKeyPattern.buildTargetId(match);
      // Ohne Resolver kann das Pattern nichts auflösen — pending-Pfad.
      expect(result).toBeNull();
    });
  });
});
