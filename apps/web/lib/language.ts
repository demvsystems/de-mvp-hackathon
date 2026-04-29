import type { ActionPlan } from '@repo/agent/shared';

import type { AssessmentReasoning, TopicContext, TopicMember, TriageTopic } from './types';

export const LANGUAGE_COOKIE = 'datenkrake-demo-language';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const EXACT_TEXT: Record<string, string> = {
  'Checkout 502 / Firmenkreditkarte': 'Checkout 502 / Corporate credit card',
  'Payment-Gateway-Timeout (502) bei Checkout mit Firmenkreditkarte; Lieferadresse-Persistenz fehlt zusätzlich.':
    'Payment gateway timeout (502) during checkout with a corporate credit card; shipping address persistence also fails.',
  'Enterprise-Kunden fordern SAML-SSO als Voraussetzung für Lizenz-Rollouts.':
    'Enterprise customers require SAML SSO as a prerequisite for license rollouts.',
  'Mobile Dashboard Performance': 'Mobile dashboard performance',
  'Außendienst-User auf älteren Android-Geräten erleben 8-10s Ladezeiten im Dashboard.':
    'Field sales users on older Android devices see 8-10s dashboard load times.',
  'Customer-Import / Mapping-Datenqualität': 'Customer import / mapping data quality',
  'Massenimport scheitert wegen fehlender Pflichtfeldprüfung im Mapper.':
    'Bulk import fails because the mapper is missing required-field validation.',
  'Tariflogik-Regressionstests': 'Tariff logic regression tests',
  'QA fordert Regressionstest-Suite gegen die letzten drei Kundenfälle der Tariflogik.':
    'QA wants a regression test suite covering the last three customer tariff-logic cases.',
  'Checkout funktioniert nicht mit Firmenkreditkarte':
    'Checkout does not work with a corporate credit card',
  'Ich kann den Checkout mit Firmenkreditkarte nicht abschließen.':
    'I cannot complete checkout with a corporate credit card.',
  'Immer noch blockiert, Bezahlung scheitert mit Fehler 502.':
    'Still blocked, payment fails with error 502.',
  'Danke für die Meldung, wir untersuchen das.': 'Thanks for reporting this, we are investigating.',
  'Wann kommt SAML-SSO?': 'When is SAML SSO coming?',
  'Unser Security-Team verlangt SAML-SSO, bevor wir die 50 Lizenzen auf alle Filialen ausrollen. Habt ihr einen Termin?':
    'Our security team requires SAML SSO before we roll out the 50 licenses to all branches. Do you have a timeline?',
  'Danke fürs Nachfragen — SSO ist auf der Roadmap für Q2 (Epic SHOP-201). Wir geben Bescheid, sobald ein konkretes Datum steht.':
    'Thanks for checking in. SSO is on the roadmap for Q2 (Epic SHOP-201). We will let you know as soon as we have a concrete date.',
  'Mobile Dashboard zu langsam': 'Mobile dashboard is too slow',
  'Im Außendienst auf älteren Android-Geräten lädt das Dashboard 8-10 Sekunden — bei schwachem Mobilfunk teils gar nicht. Bitte priorisieren.':
    'In field sales on older Android devices, the dashboard takes 8-10 seconds to load and sometimes does not load at all on weak mobile connections. Please prioritize this.',
  'Kundenimport bricht ab': 'Customer import aborts',
  "Beim Massenimport unserer 12.000 Kontakte bricht der Mapper ab — Fehler 'Required field missing in mapping table'. Wo liegt der Hänger?":
    "When bulk-importing our 12,000 contacts, the mapper aborts with 'Required field missing in mapping table'. What is causing the issue?",
  'Wir haben das Verhalten reproduziert (siehe SHOP-220). Pflichtfeldprüfung im Mapper wird in der nächsten Version ergänzt.':
    'We reproduced the behavior (see SHOP-220). Required-field validation in the mapper will be added in the next version.',
  'Fehler beim Speichern der Lieferadresse': 'Error when saving the shipping address',
  'Beim Checkout wird die geänderte Lieferadresse nicht persistiert.':
    'During checkout, the updated shipping address is not persisted.',
  'SAML-SSO für Enterprise-Tenants': 'SAML SSO for enterprise tenants',
  'Mehrere Enterprise-Kunden (Intercom conv_9003) und Upvoty-Anfragen (post_2001) fordern SAML-SSO als Voraussetzung für Lizenz-Rollouts. Q2-Commitment.':
    'Multiple enterprise customers (Intercom conv_9003) and Upvoty requests (post_2001) require SAML SSO as a prerequisite for license rollouts. Q2 commitment.',
  'Mobile-Dashboard Performance auf älteren Android-Geräten':
    'Mobile dashboard performance on older Android devices',
  'Außendienst meldet 8-10s Ladezeiten (Intercom conv_9004, Upvoty post_2002). Bundle-Splitting + Image-Optimierung prüfen.':
    'Field sales reports 8-10s load times (Intercom conv_9004, Upvoty post_2002). Investigate bundle splitting and image optimization.',
  'Customer-Import: Pflichtfeldprüfung im Mapper fehlt':
    'Customer import: missing required-field validation in mapper',
  'Ohne Pflichtfeldprüfung scheitert der Import bei leerer Zuordnungstabelle (Slack #produkt1 msg_002, Intercom conv_9005). Fix vor Mapping einbauen.':
    'Without required-field validation, the import fails when the mapping table is empty (Slack #produkt1 msg_002, Intercom conv_9005). Add the fix before mapping.',
  'Regressionstests für Tariflogik-Validierung': 'Regression tests for tariff logic validation',
  'QA hat Tariflogik fachlich geprüft (Slack #produkt1 msg_001 thread). Regressionstest gegen die letzten drei Kundenfälle als Suite verankern.':
    'QA completed the functional review of tariff logic (Slack #produkt1 msg_001 thread). Add a regression suite covering the last three customer cases.',
  'Guten Morgen, wir haben für Produkt 1 zwei offene Punkte vor dem Release: Export-Performance und Validierung der neuen Tariflogik.':
    'Good morning, we still have two open items for Product 1 before release: export performance and validation of the new tariff logic.',
  'Export-Performance habe ich gestern gemessen. Bei 10.000 Datensätzen liegen wir noch bei knapp 8 Sekunden.':
    'I measured export performance yesterday. At 10,000 records we are still just under 8 seconds.',
  'Die Tariflogik ist fachlich geprüft. Ich würde nur noch einen Regressionstest gegen die letzten drei Kundenfälle laufen lassen.':
    'The tariff logic has been functionally validated. I would only add a regression test against the last three customer cases.',
  'Ich habe gerade den Fehler aus dem Kundenimport nachgestellt. Ursache ist ein leeres Feld in der Zuordnungstabelle.':
    'I just reproduced the customer-import error. The cause is an empty field in the mapping table.',
  'Danke. Dann setze ich dafür eine Pflichtfeldprüfung vor dem Mapping und ergänze einen Hinweis im Import-Log.':
    'Thanks. I will add required-field validation before mapping and include a note in the import log.',
  'Hab gerade SHOP-142 reproduziert: Checkout failed mit 502, sobald eine Firmenkreditkarte kommt. Customer demo.user@example.com (Intercom conv_9001) hat exakt das gemeldet. Payment-Gateway-Timeout, Region eu-central.':
    'Just reproduced SHOP-142: checkout fails with 502 as soon as a corporate credit card is used. Customer demo.user@example.com (Intercom conv_9001) reported exactly that. Payment gateway timeout, region eu-central.',
  'Danke. Setze SHOP-142 auf High — blockiert das Release.':
    'Thanks. Setting SHOP-142 to High; it is blocking the release.',
  'Wir haben jetzt drei Enterprise-Anfragen zu SAML-SSO (Upvoty post_2001 + Intercom conv_9003). Slot in Q2 reservieren — Epic SHOP-201 ist auf In Progress.':
    'We now have three enterprise requests for SAML SSO (Upvoty post_2001 + Intercom conv_9003). Reserve a Q2 slot; Epic SHOP-201 is already In Progress.',
  'Außendienst meldet wieder Mobile-Dashboard-Lahmsucht (Upvoty post_2002 + Intercom conv_9004). Können wir SHOP-205 in den Sprint ziehen?':
    'Field sales is reporting slow mobile dashboard performance again (Upvoty post_2002 + Intercom conv_9004). Can we pull SHOP-205 into the sprint?',
  'SSO-Login für Enterprise-Teams': 'SSO login for enterprise teams',
  'Große Accounts fragen nach SAML-basiertem Single-Sign-On.':
    'Large accounts are asking for SAML-based single sign-on.',
  'Brauchen wir für das Security-Review im Q2-Rollout.':
    'We need this for the security review in the Q2 rollout.',
  'Mobile-Dashboard-Performance verbessern': 'Improve mobile dashboard performance',
  'Dashboard ist auf älteren Android-Geräten langsam.':
    'The dashboard is slow on older Android devices.',
  'Bitte priorisieren für Außendienst-Teams mit schwachem Mobilfunk.':
    'Please prioritize this for field sales teams on weak mobile connections.',
  'Checkout mit Firmenkreditkarte zuverlässig machen':
    'Make checkout with corporate credit cards reliable',
  'Wir hatten in den letzten zwei Wochen mehrfach Checkout-Failures (502) bei Firmenkreditkarten. Bitte priorisieren — siehe SHOP-142.':
    'Over the last two weeks we have seen repeated checkout failures (502) with corporate credit cards. Please prioritize this; see SHOP-142.',
  'Hat uns letzte Woche eine Bestellung gekostet — bitte fixen.':
    'This cost us an order last week; please fix it.',
  'Bug in mehreren Quellen bestätigt (Intercom-Kunde, Slack-Reproduktion, Upvoty-Sammelfeedback). Standard-Triade: Jira-Bug-Ticket öffnen, betroffenen Kunden in Intercom benachrichtigen, Engineering-Slack-Thread mit Ticket-Referenz updaten.':
    'Bug confirmed across multiple sources (Intercom customer, Slack reproduction, Upvoty aggregate feedback). Standard triad: open a Jira bug ticket, notify the affected customer in Intercom, and update the engineering Slack thread with the ticket reference.',
  'Checkout 502 bei Firmenkreditkarte (Payment-Gateway-Timeout)':
    'Checkout 502 with corporate credit card (payment gateway timeout)',
  'Reproduziert in Slack-Thread; mehrere Kunden betroffen (siehe Intercom conv_9001, Upvoty post_2004). Region eu-central. Akzeptanzkriterium: Checkout schlägt nicht mehr mit 502 fehl bei Firmenkreditkarte.':
    'Reproduced in a Slack thread; multiple customers affected (see Intercom conv_9001, Upvoty post_2004). Region eu-central. Acceptance criterion: checkout no longer fails with 502 for corporate credit cards.',
  'Vielen Dank für die Meldung. Wir haben das Problem reproduzieren können und ein Bug-Ticket bei unserem Engineering-Team angelegt. Sie hören von uns, sobald ein Fix verfügbar ist.':
    'Thank you for reporting this. We were able to reproduce the problem and opened a bug ticket with our engineering team. We will update you as soon as a fix is available.',
  'Bug-Ticket angelegt, Kunde via Intercom benachrichtigt. Tracking läuft.':
    'Bug ticket created, customer notified via Intercom. Tracking is in progress.',
  'Feature-Request konvergiert: 3 Enterprise-Touchpoints (Upvoty, Intercom, Slack-Aggregation). Story/Epic in Jira anlegen, Slack-Channel-Post mit aggregierter Demand-Meldung; kein Intercom-Reply nötig (Kunde ist bereits in laufender Conversation).':
    'Feature request is converging: 3 enterprise touchpoints (Upvoty, Intercom, Slack aggregation). Create a Jira story/epic, post an aggregated demand update in Slack; no Intercom reply needed because the customer is already in an ongoing conversation.',
  'Drei Enterprise-Touchpoints zu SAML-SSO konvergieren. Story angelegt, Slot in Q2-Planning vorgesehen.':
    'Three enterprise touchpoints are converging on SAML SSO. Story created and included in Q2 planning.',
  'Performance-Bug auf älteren Android-Geräten in mehreren Quellen bestätigt. Standard-Triade: Jira-Bug, Intercom-Reply (interne Notiz, da Diagnose noch unklar), Slack-Thread-Update.':
    'Performance bug on older Android devices confirmed across multiple sources. Standard triad: Jira bug, Intercom reply, and Slack thread update.',
  'Mobile Dashboard 8-10s Ladezeit auf älteren Android-Geräten':
    'Mobile dashboard with 8-10s load time on older Android devices',
  'Außendienst-User berichten 8-10s Ladezeit (Upvoty post_2002, Intercom conv_9004, Slack-Diskussion). Akzeptanzkriterium: <3s Time-to-Interactive auf Android 10+ Mid-Tier.':
    'Field sales users report 8-10s load times (Upvoty post_2002, Intercom conv_9004, Slack discussion). Acceptance criterion: <3s time-to-interactive on Android 10+ mid-tier devices.',
  'Danke für die detaillierte Beschreibung. Wir haben das Performance-Thema priorisiert und ein Bug-Ticket angelegt; wir melden uns mit einem Update, sobald wir Diagnose und Fix-Zeitplan haben.':
    'Thanks for the detailed description. We have prioritized the performance issue and opened a bug ticket; we will update you once we have a diagnosis and a fix timeline.',
  'Mobile-Performance-Bug aus mehreren Quellen aggregiert; Bug-Ticket angelegt, Kunde via Intercom benachrichtigt.':
    'Mobile performance bug aggregated across multiple sources; bug ticket created and customer notified via Intercom.',
  'Datenqualitäts-Bug bestätigt durch Kunden-Eskalation und interne Slack-Diskussion. Bug-Ticket öffnen, Kunde benachrichtigen, Slack-Channel-Post zur Sichtbarkeit (kein Discovery-Thread vorhanden).':
    'Data-quality bug confirmed by customer escalation and internal Slack discussion. Open a bug ticket, notify the customer, and post in Slack for visibility (no discovery thread exists).',
  'Massenimport scheitert ohne klare Fehlermeldung bei fehlenden Pflichtfeldern (Intercom conv_9005, Slack msg_002). Akzeptanzkriterium: Validierungs-Errors pro Zeile mit Spaltenreferenz; Vorab-Preview mit Pflichtfeld-Indikator.':
    'Bulk import fails without a clear error when required fields are missing (Intercom conv_9005, Slack msg_002). Acceptance criterion: validation errors per row with column references, plus a preflight preview with required-field indicators.',
  'Vielen Dank für das Feedback. Wir haben den Mapper-Validierungs-Gap als Bug erfasst und an unser Engineering weitergegeben; Sie hören von uns mit Status-Update.':
    'Thank you for the feedback. We logged the mapper validation gap as a bug and handed it to engineering; you will receive a status update from us.',
  'Customer-Import-Mapper hat Pflichtfeld-Validierung-Lücke; Bug-Ticket angelegt, Kunde benachrichtigt.':
    'Customer import mapper has a required-field validation gap; bug ticket created and customer notified.',
  'Internes QA-Anliegen ohne Kundenbezug — kein Intercom-Reply nötig. Story für Regressionstest-Suite anlegen, Engineering-Sichtbarkeit via Slack.':
    'Internal QA concern without direct customer impact; no Intercom reply needed. Create a story for the regression test suite and give engineering visibility via Slack.',
  'Tariflogik-Regressionstest-Suite': 'Tariff logic regression test suite',
  'QA fordert automatisierte Regressionstest-Suite gegen die letzten drei realen Kundenfälle der Tariflogik. Akzeptanzkriterium: 3 End-to-End-Tests mit Fixture-Datensätzen; CI-integriert.':
    'QA wants an automated regression test suite covering the last three real customer tariff-logic cases. Acceptance criterion: three end-to-end tests with fixture datasets, integrated into CI.',
  'Story für Tariflogik-Regressionstests angelegt; QA-Team kann Anforderung verfeinern.':
    'Story for tariff-logic regression tests created; the QA team can refine the requirement.',
};

const PHRASE_REPLACEMENTS: Array<[string, string]> = [
  ['Mock-Assessment für „', 'Mock assessment for "'],
  ['“.', '."'],
  ['Kontext: ', 'Context: '],
  ['Aktuell ', 'Currently '],
  [' Records aus ', ' records from '],
  [' Quellen, Trend ', ' sources, trend '],
  [
    'Mehrere Quellen schlagen koordiniert auf — sofortiger Blick empfohlen.',
    'Multiple sources are firing in parallel; immediate attention recommended.',
  ],
  [
    'Wiederkehrender Wunsch mit Produkt-Hebel; Roadmap-Kandidat.',
    'Recurring request with clear product leverage; candidate for the roadmap.',
  ],
  [
    'Stabile Hintergrundaktivität — beobachten, aber nicht eskalieren.',
    'Stable background activity; monitor, but do not escalate.',
  ],
  ['Ruhig; aktuell keine Aktion nötig.', 'Quiet for now; no action needed.'],
  ['Cross-Source-Spread: ', 'Cross-source spread: '],
  ['Quellen in 24h', 'sources in 24h'],
  ['Schnitt 7d: ', '7d avg: '],
  ['unterschiedliche Autoren in 7 Tagen', 'distinct authors in 7 days'],
  [
    'Mock-Heuristik: koordinierter Multi-Source-Hit',
    'Mock heuristic: coordinated multi-source hit',
  ],
  [
    'Mock-Heuristik: Produktwunsch-Muster erkannt',
    'Mock heuristic: product request pattern detected',
  ],
];

const EXACT_SUBSTRING_REPLACEMENTS = Object.entries(EXACT_TEXT).sort(
  ([left], [right]) => right.length - left.length,
);

export function isLanguage(value: string | null | undefined): value is Language {
  return value === 'de' || value === 'en';
}

export function resolveLanguage(
  value: string | null | undefined,
  fallbackLanguage: Language,
): Language {
  return isLanguage(value) ? value : fallbackLanguage;
}

export function translateDisplayText(
  text: string | null | undefined,
  language: Language,
): string | null {
  if (text == null || language === 'de') return text ?? null;

  let translated = EXACT_TEXT[text] ?? text;
  for (const [source, target] of PHRASE_REPLACEMENTS) {
    translated = translated.split(source).join(target);
  }
  for (const [source, target] of EXACT_SUBSTRING_REPLACEMENTS) {
    translated = translated.split(source).join(target);
  }
  return translated;
}

export function translateReasoning(
  reasoning: AssessmentReasoning,
  language: Language,
): AssessmentReasoning {
  if (language === 'de') return reasoning;

  return {
    sentiment_aggregate: translateDisplayText(reasoning.sentiment_aggregate, language) ?? '',
    ...(reasoning.tldr
      ? { tldr: translateDisplayText(reasoning.tldr, language) ?? reasoning.tldr }
      : {}),
    key_signals: reasoning.key_signals.map(
      (signal) => translateDisplayText(signal, language) ?? signal,
    ),
    key_artifacts: reasoning.key_artifacts,
    ...(reasoning.additional_notes
      ? {
          additional_notes:
            translateDisplayText(reasoning.additional_notes, language) ??
            reasoning.additional_notes,
        }
      : {}),
  };
}

export function translateTopicMember(member: TopicMember, language: Language): TopicMember {
  if (language === 'de') return member;

  return {
    ...member,
    title: translateDisplayText(member.title, language),
    body_snippet: translateDisplayText(member.body_snippet, language) ?? member.body_snippet,
  };
}

export function translateTriageTopic(topic: TriageTopic, language: Language): TriageTopic {
  if (language === 'de') return topic;

  return {
    ...topic,
    title: translateDisplayText(topic.title, language),
    snippet: translateDisplayText(topic.snippet, language),
    metadata: {
      ...topic.metadata,
      reasoning: translateReasoning(topic.metadata.reasoning, language),
    },
  };
}

export function translateTopicContext(topic: TopicContext, language: Language): TopicContext {
  if (language === 'de') return topic;

  return {
    ...topic,
    label: translateDisplayText(topic.label, language) ?? topic.label,
    description: translateDisplayText(topic.description, language),
    latest_assessment: {
      ...topic.latest_assessment,
      reasoning: translateReasoning(topic.latest_assessment.reasoning, language),
    },
    members: topic.members.map((member) => translateTopicMember(member, language)),
    history: topic.history.map((entry) => ({
      ...entry,
      brief_reasoning:
        translateDisplayText(entry.brief_reasoning, language) ?? entry.brief_reasoning,
    })),
  };
}

export function translateActionPlan(plan: ActionPlan, language: Language): ActionPlan {
  if (language === 'de') return plan;

  return {
    ...plan,
    rationale: translateDisplayText(plan.rationale, language) ?? plan.rationale,
    actions: plan.actions.map((action) => {
      switch (action.kind) {
        case 'create_jira_ticket':
          return {
            ...action,
            title: translateDisplayText(action.title, language) ?? action.title,
            body: translateDisplayText(action.body, language) ?? action.body,
          };
        case 'post_slack_message':
          return {
            ...action,
            body: translateDisplayText(action.body, language) ?? action.body,
          };
        case 'reply_intercom':
          return {
            ...action,
            body: translateDisplayText(action.body, language) ?? action.body,
          };
        case 'no_action':
          return {
            ...action,
            reason: translateDisplayText(action.reason, language) ?? action.reason,
          };
      }
    }),
  };
}
