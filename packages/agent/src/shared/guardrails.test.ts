import { describe, expect, it } from 'vitest';
import { detectGuardrailFlags } from './guardrails';

describe('detectGuardrailFlags – pii_like phone heuristic', () => {
  describe('does NOT flag structured numbers as phone-like', () => {
    const negatives: ReadonlyArray<readonly [string, string]> = [
      ['Slack record timestamp', 'Siehe Slack-ts 1714400000.123456 im Channel'],
      ['German thousands (millions)', '1.234.567 Bewertungen wurden gesammelt'],
      ['German tens of millions', 'Umsatz 60.000.000 Euro im Q1'],
      ['range with bare hyphen', '12.000-15.000 Kontakte aktiv'],
      ['range with spaced dash', 'Wir sehen 12.000 - 15.000 Kontakte aktiv'],
      ['range with en-dash', 'Reichweite 12.000 – 15.000 Patienten'],
      ['range with slash', '12.000/15.000 Patienten betroffen'],
      ['year range hyphen', 'Geschäftsjahre 2020-2024 wurden geprüft'],
      ['year range slash', 'Berichtszeitraum 2020/2024 abgeschlossen'],
      ['dotted version number', 'API-Schema v1.2.3.4.5 ist live'],
    ];
    for (const [label, text] of negatives) {
      it(`omits pii_like for: ${label}`, () => {
        expect(detectGuardrailFlags(text)).not.toContain('pii_like');
      });
    }
  });

  describe('flags genuine phone numbers as pii_like', () => {
    const positives: ReadonlyArray<readonly [string, string]> = [
      ['international with +', 'Bitte melden unter +49 89 1234567'],
      ['parenthesized area code', 'Tel (089) 1234-5678 ist tot'],
      ['US format with +', 'Hotline: +1-555-867-5309'],
      ['DE landline with slash', 'Erreichbar 030 / 123 456 78'],
      ['plain DE landline with hyphen', 'Erreichbar 030-12345678 tagsüber'],
    ];
    for (const [label, text] of positives) {
      it(`includes pii_like for: ${label}`, () => {
        expect(detectGuardrailFlags(text)).toContain('pii_like');
      });
    }
  });

  describe('email handling stays intact', () => {
    it('flags emails independently of the phone heuristic', () => {
      expect(detectGuardrailFlags('Mail an contact@example.com bitte')).toContain('pii_like');
    });
  });
});
