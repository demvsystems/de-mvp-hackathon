import { describe, expect, it } from 'vitest';

import {
  resolveLanguage,
  translateActionPlan,
  translateDisplayText,
  translateReasoning,
} from './language';

describe('resolveLanguage', () => {
  it('accepts supported cookie values', () => {
    expect(resolveLanguage('en', 'de')).toBe('en');
    expect(resolveLanguage('de', 'en')).toBe('de');
  });

  it('falls back for unsupported values', () => {
    expect(resolveLanguage('fr', 'en')).toBe('en');
    expect(resolveLanguage(undefined, 'de')).toBe('de');
  });
});

describe('translateDisplayText', () => {
  it('translates known demo fixture strings to english', () => {
    expect(translateDisplayText('Checkout 502 / Firmenkreditkarte', 'en')).toBe(
      'Checkout 502 / Corporate credit card',
    );
    expect(
      translateDisplayText(
        'Ich habe gerade den Fehler aus dem Kundenimport nachgestellt. Ursache ist ein leeres Feld in der Zuordnungstabelle.',
        'en',
      ),
    ).toBe(
      'I just reproduced the customer-import error. The cause is an empty field in the mapping table.',
    );
  });

  it('keeps german text unchanged in german mode', () => {
    expect(translateDisplayText('Checkout 502 / Firmenkreditkarte', 'de')).toBe(
      'Checkout 502 / Firmenkreditkarte',
    );
  });
});

describe('translateReasoning', () => {
  it('translates mock assessment boilerplate', () => {
    expect(
      translateReasoning(
        {
          sentiment_aggregate:
            'Mock-Assessment für „Checkout 502 / Firmenkreditkarte“. Kontext: Massenimport scheitert wegen fehlender Pflichtfeldprüfung im Mapper.',
          key_signals: [
            'Cross-Source-Spread: 3 Quellen in 24h',
            'Mock-Heuristik: koordinierter Multi-Source-Hit',
          ],
          key_artifacts: [],
          additional_notes: 'Aktuell 4 Records aus 3 Quellen, Trend stable.',
        },
        'en',
      ),
    ).toEqual({
      sentiment_aggregate:
        'Mock assessment for "Checkout 502 / Corporate credit card." Context: Bulk import fails because the mapper is missing required-field validation.',
      key_signals: [
        'Cross-source spread: 3 sources in 24h',
        'Mock heuristic: coordinated multi-source hit',
      ],
      key_artifacts: [],
      additional_notes: 'Currently 4 records from 3 sources, trend stable.',
    });
  });
});

describe('translateActionPlan', () => {
  it('translates visible action plan fields without changing structure', () => {
    expect(
      translateActionPlan(
        {
          rationale:
            'Internes QA-Anliegen ohne Kundenbezug — kein Intercom-Reply nötig. Story für Regressionstest-Suite anlegen, Engineering-Sichtbarkeit via Slack.',
          actions: [
            {
              kind: 'create_jira_ticket',
              project: 'SHOP',
              issue_type: 'Story',
              title: 'Tariflogik-Regressionstest-Suite',
              body: 'Story für Tariflogik-Regressionstests angelegt; QA-Team kann Anforderung verfeinern.',
            },
          ],
          cross_references: [],
        },
        'en',
      ),
    ).toEqual({
      rationale:
        'Internal QA concern without direct customer impact; no Intercom reply needed. Create a story for the regression test suite and give engineering visibility via Slack.',
      actions: [
        {
          kind: 'create_jira_ticket',
          project: 'SHOP',
          issue_type: 'Story',
          title: 'Tariff logic regression test suite',
          body: 'Story for tariff-logic regression tests created; the QA team can refine the requirement.',
        },
      ],
      cross_references: [],
    });
  });
});
