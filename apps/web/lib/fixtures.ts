import type { TopicContext, TriageTopic } from './types';

const bipro: TopicContext = {
  id: 'topic:7c8d9e1f-2a3b-4c5d-6e7f-8a9b0c1d2e3f',
  label: 'BiPro 430.4 / Concordia-Bestandsverlust',
  status: 'active',
  discovered_at: '2026-04-13T14:22:11Z',
  discovered_by: 'topic-discovery:body-only:v1',
  activity: {
    member_count: 12,
    source_count: 4,
    unique_authors_7d: 7,
    velocity_24h: 3,
    velocity_7d_avg: 1.4,
    trend: 'growing',
    last_activity_at: '2026-04-15T10:42:33Z',
  },
  stagnation: { severity: 'low', signal_count: 2 },
  latest_assessment: {
    character: 'attention',
    escalation_score: 0.84,
    assessed_at: '2026-04-15T11:08:14Z',
    reasoning: {
      sentiment_aggregate:
        'verstärkt frustriert mit Eskalations-Trend; mehrere Makler thematisieren das Bestandsverlust-Problem direkt oder via DEMV-4127',
      key_signals: [
        'drei neue Slack-Threads in 24h, alle mit Bestandsverlust-Bezug',
        'Jira-Ticket DEMV-4127 hat 5 Cross-Source-Mentions, ist aber unzugewiesen und Low-Priority',
        'Stagnations-Signal: zwei Threads ohne Antwort seit 4 Tagen',
        'WON_DEAL_005 erwähnt Topic explizit als Risiko',
        'Trend wachsend; 7-Tage-Velocity verdoppelt',
      ],
      key_artifacts: [
        'slack:msg:T01ABC/C02DEF/1714028591.012345',
        'jira:issue:10042',
        'intercom:thread:abc123',
      ],
      additional_notes:
        'Lücke zwischen Jira-Priorität (Low) und Belegdichte (12 Mitglieder, 4 Quellen) signifikant. Empfehlung: Re-Priorisierung des Tickets und Cross-Channel-Kommunikation an betroffene Makler.',
    },
  },
  members: [
    {
      id: 'slack:msg:T01ABC/C02DEF/1714028591.012345',
      type: 'message',
      source: 'slack',
      title: null,
      body_snippet: 'Stimmt — und der gleiche Einwand kam letzte Woche schon. Ist das DEMV-4127?',
      author_display_name: 'Bob Schmidt',
      occurred_at: '2026-04-15T10:42:33Z',
      edge_confidence: 0.88,
    },
    {
      id: 'slack:msg:T01ABC/C02DEF/1713890100.001000',
      type: 'message',
      source: 'slack',
      title: null,
      body_snippet:
        'Bei mir auch wieder. POOL_EXTERN_01 schluckt erneut die Sparte. Wird das jetzt mal angefasst?',
      author_display_name: 'Carla Weber',
      occurred_at: '2026-04-14T09:15:00Z',
      edge_confidence: 0.86,
    },
    {
      id: 'jira:issue:10042',
      type: 'issue',
      source: 'jira',
      title: 'BiPro Norm 430.4 – Concordia-Anbindung nachziehen',
      body_snippet:
        'Concordia liefert GDV-Daten ausschließlich über Norm 430.4. Unsere aktuelle Schnittstelle deckt 430.3 ab; Bestände gehen beim Pool-Wechsel verloren.',
      author_display_name: 'Carla Weber',
      occurred_at: '2025-11-12T08:30:00Z',
      edge_confidence: 0.95,
    },
    {
      id: 'intercom:thread:abc123',
      type: 'message',
      source: 'intercom',
      title: null,
      body_snippet:
        'Hab gerade wieder einen Vertrag zur Bestandsübertragung an POOL_EXTERN_01 gegeben — das frisst Provision.',
      author_display_name: 'Makler #224',
      occurred_at: '2026-01-22T14:15:00Z',
      edge_confidence: 0.79,
    },
    {
      id: 'confluence:comment:9123456',
      type: 'comment',
      source: 'confluence',
      title: null,
      body_snippet:
        'Achtung: die Anleitung zur 430.3-Anbindung ist veraltet, sobald Concordia umstellt — das Doc bitte sperren bis Update da ist.',
      author_display_name: 'Lena Kraus',
      occurred_at: '2026-04-12T14:33:00Z',
      edge_confidence: 0.71,
    },
  ],
  history: [
    {
      assessed_at: '2026-04-15T11:08:14Z',
      character: 'attention',
      escalation_score: 0.84,
      brief_reasoning: 'Drei neue Slack-Threads, Cross-Source-Mentions auf DEMV-4127.',
    },
    {
      assessed_at: '2026-04-14T02:00:00Z',
      character: 'attention',
      escalation_score: 0.72,
      brief_reasoning: 'Verstärkt frustriert, vier Quellen.',
    },
    {
      assessed_at: '2026-04-13T02:00:00Z',
      character: 'attention',
      escalation_score: 0.65,
      brief_reasoning: 'Frustration sichtbar, Eskalations-Trend.',
    },
  ],
};

const gptCallouts: TopicContext = {
  id: 'topic:b1d3e7a4-19f2-4d12-94c1-7c2c2b6f0011',
  label: 'GPT-Callouts in Beratungs-UI begeistern Makler',
  status: 'active',
  discovered_at: '2026-04-09T08:11:00Z',
  discovered_by: 'topic-discovery:body-only:v1',
  activity: {
    member_count: 17,
    source_count: 3,
    unique_authors_7d: 11,
    velocity_24h: 4,
    velocity_7d_avg: 2.3,
    trend: 'growing',
    last_activity_at: '2026-04-15T08:55:12Z',
  },
  stagnation: { severity: 'none', signal_count: 0 },
  latest_assessment: {
    character: 'opportunity',
    escalation_score: 0.71,
    assessed_at: '2026-04-15T09:30:00Z',
    reasoning: {
      sentiment_aggregate:
        'durchgehend positive Resonanz auf das neue GPT-Callout im Beratungs-Modal; mehrere Makler fragen nach Roll-out auf weitere Sparten',
      key_signals: [
        'sechs Slack-Posts mit explizitem "endlich"/"super" in 7 Tagen',
        'zwei Intercom-Threads mit Feature-Wunsch zur Übertragung auf KFZ',
        'kein einziger Beschwerde-Thread im Zeitraum',
        'Velocity zieht an — 4 neue Mitglieder in 24h',
      ],
      key_artifacts: ['slack:msg:T01ABC/C04PRO/1713988800.000200', 'intercom:thread:def456'],
      additional_notes:
        'Kandidat für Marketing-Story. Empfehlung: Quick-Win-Roll-out auf KFZ vor dem nächsten Vertriebs-Event.',
    },
  },
  members: [
    {
      id: 'slack:msg:T01ABC/C04PRO/1713988800.000200',
      type: 'message',
      source: 'slack',
      title: null,
      body_snippet:
        'Endlich — die Erklärung kommt direkt im Modal. Spart mir bei jedem zweiten Kunden den Rückruf.',
      author_display_name: 'Andreas Berg',
      occurred_at: '2026-04-15T08:55:12Z',
      edge_confidence: 0.91,
    },
    {
      id: 'intercom:thread:def456',
      type: 'message',
      source: 'intercom',
      title: null,
      body_snippet:
        'Können wir das Callout auch in der KFZ-Strecke kriegen? Wäre Gold wert beim Tarif-Wechsel.',
      author_display_name: 'Makler #118',
      occurred_at: '2026-04-14T16:22:00Z',
      edge_confidence: 0.83,
    },
    {
      id: 'github:pr:platform/web/2104',
      type: 'pull_request',
      source: 'github',
      title: 'feat(beratung): inline GPT-Callout for Sparte explainer',
      body_snippet: 'Adds /assist endpoint and renders inline guidance in the consultation modal.',
      author_display_name: 'tim.wendt',
      occurred_at: '2026-04-08T11:02:00Z',
      edge_confidence: 0.93,
    },
  ],
  history: [
    {
      assessed_at: '2026-04-15T09:30:00Z',
      character: 'opportunity',
      escalation_score: 0.71,
      brief_reasoning: 'Positives Resonanz-Cluster wächst, Cross-Sparte-Wunsch laut.',
    },
    {
      assessed_at: '2026-04-12T02:00:00Z',
      character: 'opportunity',
      escalation_score: 0.58,
      brief_reasoning: 'Frühe positive Signale aus Beta-Gruppe.',
    },
  ],
};

const onboardingDrop: TopicContext = {
  id: 'topic:5a2c4f86-aa01-4b3a-b9b2-9c2eaa11ab02',
  label: 'Onboarding-Friction beim dritten Vertragsupload',
  status: 'active',
  discovered_at: '2026-04-10T11:00:00Z',
  discovered_by: 'topic-discovery:body-only:v1',
  activity: {
    member_count: 9,
    source_count: 3,
    unique_authors_7d: 6,
    velocity_24h: 2,
    velocity_7d_avg: 1.0,
    trend: 'stable',
    last_activity_at: '2026-04-15T07:14:22Z',
  },
  stagnation: { severity: 'medium', signal_count: 3 },
  latest_assessment: {
    character: 'attention',
    escalation_score: 0.66,
    assessed_at: '2026-04-15T08:00:00Z',
    reasoning: {
      sentiment_aggregate:
        'wiederkehrender Bug bei Vertragsimport ab dem dritten File; Frustration in Onboarding-Calls erkennbar',
      key_signals: [
        'GitHub-Issue onboardflow/api#42 seit 2 Tagen offen, hohe Mention-Dichte',
        'drei Slack-Threads mit Schritt-für-Schritt-Reproduktion',
        'Stagnations-Signal: ein Thread ohne Antwort seit 5 Tagen',
        'kein Roll-back-Plan dokumentiert',
      ],
      key_artifacts: ['github:issue:onboardflow/api/42'],
    },
  },
  members: [
    {
      id: 'github:issue:onboardflow/api/42',
      type: 'issue',
      source: 'github',
      title: 'Vertragsimport bricht bei dritter Datei ab',
      body_snippet:
        'Beim Hochladen einer dritten Datei in einem Onboarding-Flow läuft die Pipeline in einen Timeout. Stack-Trace zeigt Drosselung bei pdf-extract.',
      author_display_name: 'mareike.koch',
      occurred_at: '2026-04-14T11:02:00Z',
      edge_confidence: 0.94,
    },
    {
      id: 'slack:msg:T01ABC/C05ONB/1713890400.000400',
      type: 'message',
      source: 'slack',
      title: null,
      body_snippet:
        'Onboarding eben wieder bei Datei 3 abgebrochen. Dritter Termin in dieser Woche, der dadurch gestreckt wurde.',
      author_display_name: 'Lukas Mertens',
      occurred_at: '2026-04-15T07:14:22Z',
      edge_confidence: 0.81,
    },
  ],
  history: [
    {
      assessed_at: '2026-04-15T08:00:00Z',
      character: 'attention',
      escalation_score: 0.66,
      brief_reasoning: 'Wiederholter Bug, fehlender Roll-back-Plan.',
    },
  ],
};

const docTone: TopicContext = {
  id: 'topic:9b1c0d4e-44ff-4d7a-9c11-a8b3e1f02233',
  label: 'Doc-Tonalität auf der Makler-Landingpage',
  status: 'active',
  discovered_at: '2026-04-11T10:00:00Z',
  discovered_by: 'topic-discovery:body-only:v1',
  activity: {
    member_count: 5,
    source_count: 2,
    unique_authors_7d: 3,
    velocity_24h: 0,
    velocity_7d_avg: 0.5,
    trend: 'stable',
    last_activity_at: '2026-04-13T12:00:00Z',
  },
  stagnation: { severity: 'low', signal_count: 1 },
  latest_assessment: {
    character: 'noteworthy',
    escalation_score: 0.42,
    assessed_at: '2026-04-15T03:00:00Z',
    reasoning: {
      sentiment_aggregate:
        'sachliche Diskussion über Tonalität der Onboarding-Doku; kein Eskalations-Druck, aber sichtbar offene Schleife',
      key_signals: [
        'zwei Confluence-Kommentare mit konkreten Vorschlägen',
        'ein Slack-Thread mit Konsens-Andeutung, ohne Abschluss',
      ],
      key_artifacts: ['confluence:page:8821', 'slack:msg:T01ABC/C09DOC/1713810000.000900'],
    },
  },
  members: [
    {
      id: 'confluence:page:8821',
      type: 'page',
      source: 'confluence',
      title: 'Makler-Landingpage — Tonalität',
      body_snippet:
        'Vorschlag: Anrede in zweite Person, Beispiele aus Vertriebs-Realität statt Marketing-Sprache.',
      author_display_name: 'Lena Kraus',
      occurred_at: '2026-04-11T10:00:00Z',
      edge_confidence: 0.74,
    },
  ],
  history: [
    {
      assessed_at: '2026-04-15T03:00:00Z',
      character: 'noteworthy',
      escalation_score: 0.42,
      brief_reasoning: 'Sachliche Diskussion, keine Eskalation.',
    },
  ],
};

const calmRelease: TopicContext = {
  id: 'topic:c0a3e7f8-bb22-4d44-aa55-1f2e3d4c5b6a',
  label: 'Release-Kadenz Q2 abgestimmt',
  status: 'active',
  discovered_at: '2026-04-08T09:00:00Z',
  discovered_by: 'topic-discovery:body-only:v1',
  activity: {
    member_count: 3,
    source_count: 2,
    unique_authors_7d: 2,
    velocity_24h: 0,
    velocity_7d_avg: 0.1,
    trend: 'dormant',
    last_activity_at: '2026-04-08T15:00:00Z',
  },
  stagnation: { severity: 'none', signal_count: 0 },
  latest_assessment: {
    character: 'calm',
    escalation_score: 0.12,
    assessed_at: '2026-04-15T02:00:00Z',
    reasoning: {
      sentiment_aggregate: 'neutrale Diskussion, kein Handlungsdruck',
      key_signals: [
        'nur 3 Mitglieder, alle aus Slack/Confluence',
        'letzte Aktivität vor 7 Tagen',
        'kein Stagnations-Signal, kein Cross-Source-Spread',
        'Diskussion endete mit Konsens',
      ],
      key_artifacts: ['slack:msg:T01ABC/C03GHI/1713456000.001000'],
    },
  },
  members: [
    {
      id: 'slack:msg:T01ABC/C03GHI/1713456000.001000',
      type: 'message',
      source: 'slack',
      title: null,
      body_snippet: 'Plan steht: 14-Tage-Kadenz, Hotfixes asynchron. Wir tracken in Confluence.',
      author_display_name: 'Florian Müller',
      occurred_at: '2026-04-08T15:00:00Z',
      edge_confidence: 0.9,
    },
  ],
  history: [
    {
      assessed_at: '2026-04-15T02:00:00Z',
      character: 'calm',
      escalation_score: 0.12,
      brief_reasoning: 'Konsens erreicht, keine offene Schleife.',
    },
  ],
};

export const topicContexts: TopicContext[] = [
  bipro,
  gptCallouts,
  onboardingDrop,
  docTone,
  calmRelease,
];

export const triageTopics: TriageTopic[] = topicContexts.map((t) => ({
  id: t.id,
  type: 'topic' as const,
  title: t.label,
  snippet: t.latest_assessment.reasoning.sentiment_aggregate,
  source: 'topic' as const,
  scoring: {
    score: t.latest_assessment.escalation_score,
    matched_via: [{ type: 'topic_membership', topic_id: t.id, topic_confidence: 1.0 }],
  },
  metadata: {
    character: t.latest_assessment.character,
    reasoning: t.latest_assessment.reasoning,
    last_activity_at: t.activity.last_activity_at,
    member_count: t.activity.member_count,
    source_count: t.activity.source_count,
    stagnation_severity: t.stagnation.severity,
  },
}));

export function getTopicContext(id: string): TopicContext | undefined {
  return topicContexts.find((t) => t.id === id);
}
