'use client';

import { useState, useEffect } from 'react';

type Risk = 'HIGH' | 'MEDIUM' | 'LOW';
type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'done';
type FeedbackValue = 'up' | 'down' | null;

interface SuggestedAction {
  id: string;
  target: 'slack' | 'upvoty' | 'jira' | 'intercom';
  label: string;
  preview: string;
  status: ActionStatus;
}

interface Implication {
  text: string;
  type: 'warning' | 'info' | 'opportunity';
}

interface Signal {
  source: string;
  type: string;
  text: string;
  daysAgo: number;
}

interface CrossLink {
  scenarioId: string;
  title: string;
  subtitle: string;
  reason: string;
  relationStatus: 'conflict' | 'overlap' | 'opportunity' | 'connection';
}

interface LyraInsight {
  question: string;
  answer: string;
  type: 'blind_spot' | 'already_working' | 'priority_gap' | 'connection';
}

interface Scenario {
  id: string;
  title: string;
  subtitle: string;
  cluster: string;
  clusterReadable: string;
  risk: Risk;
  confidence: number;
  signals: Signal[];
  nextAction: string;
  sources: number;
  matchCount: number;
  implications: Implication[];
  suggestedActions: SuggestedAction[];
  crossLinks: CrossLink[];
  lyraInsights: LyraInsight[];
  feedback: FeedbackValue;
}

const INITIAL_SCENARIOS: Scenario[] = [
  {
    id: 'scn_01',
    title: 'Datenverlust bei Systemwechsel',
    subtitle: 'Kundendaten gehen beim Wechsel zu einem neuen Pool verloren',
    cluster: 'bipro_bestandsuebertragung',
    clusterReadable: 'Datenverlust · Systemintegration',
    risk: 'HIGH',
    confidence: 91,
    signals: [
      {
        source: 'intercom',
        type: 'Support-Chat',
        text: 'Sparte und Zahlweise gehen bei Übertragung verloren – drittes Mal diese Woche.',
        daysAgo: 2,
      },
      {
        source: 'facebook',
        type: 'Community',
        text: "Wer kennt das Problem? Bestand kommt nur als 'sonstiges' an.",
        daysAgo: 8,
      },
      {
        source: 'jira',
        type: 'Ticket DEMV-4127',
        text: 'BiPro Norm 430.4 – Priorität Low seit Q4/2025.',
        daysAgo: 142,
      },
      {
        source: 'slack',
        type: 'Interne Diskussion',
        text: 'Mehrere Kunden melden dasselbe. Wird das zentral getrackt?',
        daysAgo: 5,
      },
      {
        source: 'meeting',
        type: 'Kundengespräch',
        text: "Kunde: 'Das muss in 8 Wochen gelöst sein, sonst breche ich ab.'",
        daysAgo: 12,
      },
    ],
    nextAction:
      'Support-Ticket hochstufen. Produktteam informieren. Kunden proaktiv mit Status-Update kontaktieren.',
    sources: 4,
    matchCount: 14,
    implications: [
      {
        text: 'Wenn du das Ticket hochstufst, solltest du gleichzeitig den betroffenen Kunden in Support benachrichtigen.',
        type: 'info',
      },
      {
        text: 'Frist läuft in 8 Wochen ab – kein Puffer mehr für normale Priorisierung.',
        type: 'warning',
      },
      { text: '5 weitere Kunden mit ähnlichem Bestand könnten betroffen sein.', type: 'warning' },
    ],
    suggestedActions: [
      {
        id: 'a1',
        target: 'jira',
        label: 'Ticket-Priorität hochstufen',
        preview:
          'DEMV-4127: Priorität Low → High. Kommentar: Agent hat 14 Signale aus 4 Quellen erkannt, Deal-Frist in 8 Wochen.',
        status: 'pending',
      },
      {
        id: 'a2',
        target: 'slack',
        label: 'Produktteam auf Slack benachrichtigen',
        preview:
          '#produkt: Datenverlust-Cluster erkannt. 14 Signale, 4 Quellen, 90 Tage. Deal-Risiko aktiv. Bitte DEMV-4127 priorisieren.',
        status: 'pending',
      },
      {
        id: 'a3',
        target: 'intercom',
        label: 'Kunden proaktiv kontaktieren',
        preview:
          'An betroffenen Kunden: Wir haben das Thema auf unsere Prioritätsliste gesetzt und melden uns in 2 Wochen mit einem Update.',
        status: 'pending',
      },
    ],
    crossLinks: [
      {
        scenarioId: 'scn_05',
        title: 'Einstiegsprobleme',
        subtitle: 'Neue Kunden scheitern in den ersten Wochen',
        reason:
          'Datenverlust beim Start verursacht dieselbe Frustration wie Onboarding-Abbrüche. Möglicherweise derselbe Kundentyp.',
        relationStatus: 'overlap',
      },
      {
        scenarioId: 'scn_02',
        title: 'IT-seitige Blockade',
        subtitle: 'IT-Anforderungen verhindern den Abschluss',
        reason:
          'Beide Themen betreffen technische Hürden beim Systemwechsel. Produktteam kennt wahrscheinlich beide.',
        relationStatus: 'connection',
      },
    ],
    lyraInsights: [
      {
        question: 'Arbeitet jemand schon daran?',
        answer:
          'Jira-Ticket DEMV-4127 existiert seit 142 Tagen auf Priorität Low. Jemand hat das Problem erkannt – aber die Dringlichkeit nicht eingeschätzt.',
        type: 'already_working',
      },
      {
        question: 'Warum wurde es bisher nicht gelöst?',
        answer:
          'Das Ticket hat 0 verknüpfte Support-Fälle. Das interne Team sieht keine Häufigkeit – weil Kundensignale nicht mit Tickets verbunden werden.',
        type: 'blind_spot',
      },
      {
        question: 'Was wird übersehen?',
        answer:
          'Der Datenverlust ist kein technischer Einzel-Bug. Er ist ein Muster: 14 Kunden, 90 Tage, 4 Kanäle. Das Produktteam weiß das nicht.',
        type: 'priority_gap',
      },
    ],
    feedback: null,
  },
  {
    id: 'scn_02',
    title: 'IT-seitige Blockade',
    subtitle: 'IT-Anforderungen verhindern den Vertragsabschluss',
    cluster: 'exchange_shared_mailbox',
    clusterReadable: 'IT-Blocker · E-Mail-Integration',
    risk: 'HIGH',
    confidence: 84,
    signals: [
      {
        source: 'intercom',
        type: 'Support-Chat',
        text: 'Shared Mailbox fehlt. Ohne E-Mail-Integration können wir nicht wechseln.',
        daysAgo: 6,
      },
      {
        source: 'meeting',
        type: 'Kundengespräch',
        text: "IT-Verantwortlicher: 'Das ist ein Ausschlusskriterium für uns.'",
        daysAgo: 18,
      },
      {
        source: 'facebook',
        type: 'Community',
        text: 'Suche Software mit Exchange-Integration. Ohne geht kein Büro mit mehreren Mitarbeitern.',
        daysAgo: 22,
      },
      {
        source: 'jira',
        type: 'Ticket DEMV-3891',
        text: 'E-Mail-Integration – Status: Backlog, ungeschätzt, 0 verknüpfte Fälle.',
        daysAgo: 249,
      },
    ],
    nextAction: 'E-Mail-Integration als strategische Priorität einstufen – nicht als Einzelwunsch.',
    sources: 3,
    matchCount: 6,
    implications: [
      {
        text: '3 verlorene Deals in Q1 mit identischer Ursache. Segment: Büros mit mehr als 2 Mitarbeitern.',
        type: 'warning',
      },
      {
        text: 'Wenn du das Ticket hochstufst, solltest du auch das Datenverlust-Thema (Szenario 01) gleichzeitig adressieren – beide blockieren denselben Kundentyp.',
        type: 'info',
      },
    ],
    suggestedActions: [
      {
        id: 'b1',
        target: 'jira',
        label: 'Ticket mit Deal-Verlust-Evidenz verknüpfen',
        preview:
          'DEMV-3891: 3 verlorene Deals Q1 durch fehlende E-Mail-Integration. Segment: Büros ab 2 MA. Priorität: Medium → High.',
        status: 'pending',
      },
      {
        id: 'b2',
        target: 'slack',
        label: 'Vertrieb über Muster informieren',
        preview:
          '#vertrieb: IT-Blocker-Muster erkannt. Bei Kundenterminen frühzeitig nach E-Mail-Setup fragen – verhindert späte Abbrüche.',
        status: 'pending',
      },
    ],
    crossLinks: [
      {
        scenarioId: 'scn_01',
        title: 'Datenverlust bei Systemwechsel',
        subtitle: 'Kundendaten gehen beim Wechsel verloren',
        reason:
          'Beide Themen blockieren dieselbe Kundengruppe: technisch anspruchsvolle Büros mit eigener IT.',
        relationStatus: 'overlap',
      },
      {
        scenarioId: 'scn_05',
        title: 'Einstiegsprobleme',
        subtitle: 'Neue Kunden scheitern in den ersten Wochen',
        reason:
          'IT-Blockade verhindert Start. Wenn Kunden trotzdem anfangen, stoßen sie auf Onboarding-Probleme.',
        relationStatus: 'connection',
      },
    ],
    lyraInsights: [
      {
        question: 'Arbeitet jemand schon daran?',
        answer:
          'Ticket DEMV-3891 seit 249 Tagen im Backlog. Bekannt – aber nie mit Business-Impact verknüpft.',
        type: 'already_working',
      },
      {
        question: 'Was wird übersehen?',
        answer:
          '0 verknüpfte Support-Fälle im Ticket – obwohl 3 Deals genau daran gescheitert sind. Die Verbindung wurde nie hergestellt.',
        type: 'blind_spot',
      },
      {
        question: 'Wo liegt die eigentliche Prioritätslücke?',
        answer:
          'Das Ticket sieht wie ein Nice-to-have aus. In Wirklichkeit ist es ein Segment-Killer für Büros ab 2 Mitarbeitern.',
        type: 'priority_gap',
      },
    ],
    feedback: null,
  },
  {
    id: 'scn_03',
    title: 'Falsche Provisionserwartung',
    subtitle: 'Kunden vergleichen alte Konditionen mit neuen – auf falscher Basis',
    cluster: 'provision_kv_konditionen',
    clusterReadable: 'Einwand · Provisionsvergleich',
    risk: 'MEDIUM',
    confidence: 78,
    signals: [
      {
        source: 'intercom',
        type: 'Support-Chat',
        text: 'Ich hatte höhere Provisionen bei meinem alten Anbieter. Warum soll ich weniger bekommen?',
        daysAgo: 4,
      },
      {
        source: 'meeting',
        type: 'Kundengespräch',
        text: 'Kunde vergleicht Ausschließlichkeits-Provisionen mit Pool-Konditionen – ein Äpfel-Birnen-Vergleich.',
        daysAgo: 9,
      },
      {
        source: 'facebook',
        type: 'Community',
        text: 'Wer hat es geschafft, bessere Konditionen rauszuholen?',
        daysAgo: 15,
      },
      {
        source: 'crm',
        type: 'CRM-Notiz',
        text: 'Q1: 12 von 38 verlorenen Deals wegen Provisionserwartung. 8 davon Wechsler vom alten System.',
        daysAgo: 30,
      },
    ],
    nextAction:
      'Einheitliches Argumentations-Skript entwickeln. Lösung proaktiv kommunizieren statt erst auf Einwand warten.',
    sources: 4,
    matchCount: 12,
    implications: [
      { text: '12 verlorene Deals = direkt messbarer Verlust Q1.', type: 'warning' },
      {
        text: 'Eine Lösung existiert bereits – sie wird nur nicht konsistent kommuniziert. 3 von 8 Fällen wurden korrekt beraten.',
        type: 'opportunity',
      },
      {
        text: 'Community-Post mit positiver Erfahrung vorhanden – könnte als Referenz genutzt werden.',
        type: 'opportunity',
      },
    ],
    suggestedActions: [
      {
        id: 'c1',
        target: 'upvoty',
        label: 'Feature-Wunsch: Transparente Provisionsübersicht in der App',
        preview:
          'Kunden-Feedback-Board: Direkter Vergleich alter vs. neuer Konditionen in der Software würde Einwände reduzieren. Hintergrund: 12 verlorene Deals Q1.',
        status: 'pending',
      },
      {
        id: 'c2',
        target: 'slack',
        label: 'Vertrieb über Argumentations-Lücke informieren',
        preview:
          '#vertrieb: Provisions-Einwand 12x in Q1. Lösung existiert, wird aber nur in 3 von 8 Fällen genutzt. Skript-Update folgt.',
        status: 'pending',
      },
    ],
    crossLinks: [
      {
        scenarioId: 'scn_04',
        title: 'KI-Feature positiv wahrgenommen',
        subtitle: 'Markt honoriert den KI-Assistenten stark',
        reason:
          'Kunden die wegen Provisionen zögern, lassen sich oft durch das KI-Feature überzeugen. Könnte als Gegenargument genutzt werden.',
        relationStatus: 'opportunity',
      },
    ],
    lyraInsights: [
      {
        question: 'Arbeitet jemand schon daran?',
        answer:
          'Nein. Kein Ticket, kein Projekt. Das Muster ist nur in CRM-Notizen verstreut – niemand hat es aggregiert.',
        type: 'already_working',
      },
      {
        question: 'Was wird übersehen?',
        answer:
          'Die Lösung existiert bereits: ein spezielles Angebot für Wechsler. Sie wird aber nur in 25% der Fälle eingesetzt.',
        type: 'blind_spot',
      },
      {
        question: 'Welche Verbindung fehlt?',
        answer:
          'Szenario 04 zeigt: Kunden mit KI-Fokus fragen seltener nach Provisionen. Das ist ein ungenutzter Hebel.',
        type: 'connection',
      },
    ],
    feedback: null,
  },
  {
    id: 'scn_04',
    title: 'KI-Feature positiv wahrgenommen',
    subtitle:
      'Markt honoriert den KI-Assistenten stark – wird aber nicht als Verkaufsargument genutzt',
    cluster: 'mva_ki_feature',
    clusterReadable: 'Chance · Produktwahrnehmung',
    risk: 'LOW',
    confidence: 88,
    signals: [
      {
        source: 'intercom',
        type: 'Support-Chat',
        text: 'Der KI-Assistent spart mir 20 Minuten pro Fall. Sehr stark.',
        daysAgo: 3,
      },
      {
        source: 'meeting',
        type: 'Kundengespräch',
        text: "Kunde: 'Das hat mich überzeugt. Das haben andere nicht.'",
        daysAgo: 14,
      },
      {
        source: 'facebook',
        type: 'Community',
        text: 'Neues KI-Feature ist der Hammer. Habe gestern zwei Stunden gespart.',
        daysAgo: 7,
      },
      {
        source: 'slack',
        type: 'Interner Channel',
        text: '300 Teilnehmer im Webinar, fast nur positives Feedback. Warum steht das nicht prominent auf der Website?',
        daysAgo: 21,
      },
    ],
    nextAction: 'KI-Feature als primäres Verkaufsargument positionieren. Datenschutz-FAQ aufbauen.',
    sources: 4,
    matchCount: 23,
    implications: [
      {
        text: 'Stärkster positiver Cluster im gesamten Datensatz – wird in Marketing und Vertrieb noch nicht genutzt.',
        type: 'opportunity',
      },
      {
        text: 'Datenschutz-Fragen tauchen parallel auf. Ohne FAQ verliert die positive Wahrnehmung an Wirkung.',
        type: 'warning',
      },
    ],
    suggestedActions: [
      {
        id: 'd1',
        target: 'upvoty',
        label: 'Datenschutz-FAQ als Feature-Wunsch erfassen',
        preview:
          'Kunden fragen regelmäßig nach Datenschutz beim KI-Assistenten. Integrierte FAQ würde Conversion erhöhen.',
        status: 'pending',
      },
      {
        id: 'd2',
        target: 'slack',
        label: 'Marketing auf Chance hinweisen',
        preview:
          '#marketing: KI-Assistent-Cluster zeigt 23 positive Signale aus 4 Quellen. Empfehlung: als primäres Argument positionieren.',
        status: 'pending',
      },
    ],
    crossLinks: [
      {
        scenarioId: 'scn_03',
        title: 'Falsche Provisionserwartung',
        subtitle: 'Kunden vergleichen auf falscher Basis',
        reason: 'KI-Mehrwert kann Provisionseinwaende entkraeften.',
        relationStatus: 'opportunity',
      },
    ],
    lyraInsights: [
      {
        question: 'Wird diese Chance schon genutzt?',
        answer:
          'Nein. 23 positive Signale – kein einziges davon fließt systematisch in Marketing oder Vertrieb ein.',
        type: 'blind_spot',
      },
      {
        question: 'Was passiert wenn wir nichts tun?',
        answer:
          'Konkurrenz wird ähnliche Features bauen. Das Zeitfenster für Differenzierung ist jetzt offen.',
        type: 'priority_gap',
      },
      {
        question: 'Welche Verbindung fehlt?',
        answer:
          'Szenario 03 und 04 sollten gemeinsam gespielt werden: Effizienz als Gegenargument auf Einwaende.',
        type: 'connection',
      },
    ],
    feedback: null,
  },
  {
    id: 'scn_05',
    title: 'Einstiegsprobleme',
    subtitle: 'Neue Kunden scheitern in den ersten Wochen – ohne es laut zu sagen',
    cluster: 'onboarding_friction',
    clusterReadable: 'Kundenverlust · Einstiegshürden',
    risk: 'MEDIUM',
    confidence: 73,
    signals: [
      {
        source: 'intercom',
        type: 'Support-Chat',
        text: 'Beim Datenimport bekomme ich eine Fehlermeldung, die ich nicht verstehe.',
        daysAgo: 11,
      },
      {
        source: 'meeting',
        type: 'Kundengespräch',
        text: "Kunde: 'Dritter Anlauf bis es klappte. Die Anleitung passt nicht zur aktuellen Version.'",
        daysAgo: 17,
      },
      {
        source: 'facebook',
        type: 'Community',
        text: 'Hilfe-Videos sind veraltet. Nach drei Wochen endlich fertig eingerichtet.',
        daysAgo: 25,
      },
      {
        source: 'jira',
        type: 'Ticket DEMV-4321',
        text: 'Hilfe-Inhalte aktualisieren – Priorität Low, seit 10 Monaten offen.',
        daysAgo: 310,
      },
    ],
    nextAction:
      'Hilfe-Inhalte sofort aktualisieren. Persönlichen Einführungstermin in ersten 7 Tagen verbindlich anbieten.',
    sources: 4,
    matchCount: 8,
    implications: [
      { text: 'Zeit bis zur produktiven Nutzung: 19 Tage statt Ziel 7 Tage.', type: 'warning' },
      { text: 'Nur 8 von 42 Support-Fällen wurden vom Kunden selbst gemeldet.', type: 'info' },
    ],
    suggestedActions: [
      {
        id: 'e1',
        target: 'jira',
        label: 'Hilfe-Inhalte-Ticket hochstufen',
        preview:
          'DEMV-4321: Priorität Low → Medium. Kommentar: 8 Signale, Zeit bis Produktivität 2.7x über Ziel.',
        status: 'pending',
      },
      {
        id: 'e2',
        target: 'intercom',
        label: 'Betroffene Kunden proaktiv ansprechen',
        preview: 'An alle Kunden in Einführungsphase > 7 Tage: kurzer Check-in und Hilfe anbieten.',
        status: 'pending',
      },
    ],
    crossLinks: [
      {
        scenarioId: 'scn_01',
        title: 'Datenverlust bei Systemwechsel',
        subtitle: 'Kundendaten gehen beim Wechsel verloren',
        reason: 'Datenverlust und Onboarding-Probleme kumulieren beim gleichen Kundentyp.',
        relationStatus: 'overlap',
      },
      {
        scenarioId: 'scn_02',
        title: 'IT-seitige Blockade',
        subtitle: 'IT-Anforderungen verhindern den Abschluss',
        reason: 'Wer IT-Huerden überwindet, stößt oft danach auf Onboarding-Hürden.',
        relationStatus: 'connection',
      },
    ],
    lyraInsights: [
      {
        question: 'Arbeitet jemand schon daran?',
        answer:
          'Ticket DEMV-4321 seit 310 Tagen offen. Bekannt – aber nie mit Kundenverlust verbunden.',
        type: 'already_working',
      },
      {
        question: 'Warum ist es still geblieben?',
        answer: 'Kunden beschweren sich selten laut – sie verschwinden still.',
        type: 'blind_spot',
      },
      {
        question: 'Was passiert wenn wir nichts tun?',
        answer: 'Stille Abwanderung und weniger Weiterempfehlungen.',
        type: 'priority_gap',
      },
    ],
    feedback: null,
  },
];

const SOURCE_COLORS: Record<string, { accent: string; label: string }> = {
  intercom: { accent: '#3b82f6', label: 'Support-Chat' },
  facebook: { accent: '#6366f1', label: 'Community' },
  jira: { accent: '#22c55e', label: 'Ticket-System' },
  slack: { accent: '#f59e0b', label: 'Interner Chat' },
  meeting: { accent: '#a855f7', label: 'Kundengespräch' },
  crm: { accent: '#06b6d4', label: 'CRM' },
  upvoty: { accent: '#84cc16', label: 'Feedback-Board' },
};

const RISK_CONFIG: Record<Risk, { color: string; bg: string; label: string }> = {
  HIGH: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', label: 'JETZT HANDELN' },
  MEDIUM: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'BEOBACHTEN' },
  LOW: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', label: 'CHANCE' },
};

const TARGET_CONFIG: Record<string, { color: string; label: string }> = {
  slack: { color: '#f59e0b', label: 'Slack' },
  jira: { color: '#22c55e', label: 'Ticket' },
  upvoty: { color: '#84cc16', label: 'Feedback-Board' },
  intercom: { color: '#3b82f6', label: 'Support' },
};

const IMPL_CONFIG = {
  warning: { color: '#ef4444', icon: '⚠' },
  info: { color: '#3b82f6', icon: '→' },
  opportunity: { color: '#22c55e', icon: '↗' },
};

const LYRA_CONFIG = {
  already_working: { color: '#f59e0b', icon: '⚙', label: 'Wird schon bearbeitet?' },
  blind_spot: { color: '#ef4444', icon: '◉', label: 'Was wird übersehen?' },
  priority_gap: { color: '#a855f7', icon: '△', label: 'Prioritätslücke' },
  connection: { color: '#06b6d4', icon: '⟷', label: 'Verbindung zu anderen Themen' },
};

const RELATION_CONFIG = {
  conflict: { color: '#ef4444', label: 'Konflikt' },
  overlap: { color: '#f59e0b', label: 'Überschneidung' },
  opportunity: { color: '#22c55e', label: 'Hebel' },
  connection: { color: '#3b82f6', label: 'Zusammenhang' },
};

const AGENT_SIM_NOTES = [
  'Pipeline-Hinweis: Aktuell nur simulierte Agentenlogik auf statischen Szenariodaten.',
  'Ich priorisiere nach Risiko x Signalanzahl x Fristnähe und leite empfohlene Aktionen ab.',
  'Nächster Ausbau: persistente Action-Events und echter Connector-Output aus Intercom/Jira/Slack/Upvoty.',
];

function relDays(d: number) {
  if (d === 0) return 'heute';
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  if (d < 30) return `vor ${Math.round(d / 7)} Wo.`;
  if (d < 365) return `vor ${Math.round(d / 30)} Mon.`;
  return `vor ${Math.round(d / 365)} J.`;
}

export default function PWXAgentConsole() {
  const [scenarios, setScenarios] = useState<Scenario[]>(INITIAL_SCENARIOS);
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState<number[]>([]);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'signals' | 'lyra' | 'crosslinks' | 'actions'>(
    'signals',
  );
  const [simNote, setSimNote] = useState<string>(AGENT_SIM_NOTES[0] ?? '');

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sorted = [...INITIAL_SCENARIOS].sort((a, b) => {
      const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return riskOrder[a.risk] - riskOrder[b.risk] || b.matchCount - a.matchCount;
    });
    // Sort einmalig im Mount; setState aus dem Effect-Body als reine Initialisierung
    // ist hier akzeptabel, eslint-Regel passt aber nicht. Setzen via queueMicrotask,
    // um den Render-Loop sauber zu halten.
    queueMicrotask(() => setScenarios(sorted));
    sorted.forEach((_, i) => {
      setTimeout(() => setVisible((v) => (v.includes(i) ? v : [...v, i])), i * 100);
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSimNote((prev) => {
        const idx = AGENT_SIM_NOTES.indexOf(prev);
        return AGENT_SIM_NOTES[(idx + 1) % AGENT_SIM_NOTES.length] ?? AGENT_SIM_NOTES[0] ?? '';
      });
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleAction = (scnIdx: number, actionId: string, approve: boolean) => {
    setScenarios((prev) =>
      prev.map((s, i) => {
        if (i !== scnIdx) return s;
        return {
          ...s,
          suggestedActions: s.suggestedActions.map((a) => {
            if (a.id !== actionId) return a;
            if (!approve) return { ...a, status: 'rejected' as ActionStatus };
            setExecutingId(actionId);
            setTimeout(() => {
              setExecutingId(null);
              setScenarios((p) =>
                p.map((ss, ii) =>
                  ii !== scnIdx
                    ? ss
                    : {
                        ...ss,
                        suggestedActions: ss.suggestedActions.map((aa) =>
                          aa.id === actionId ? { ...aa, status: 'done' as ActionStatus } : aa,
                        ),
                      },
                ),
              );
            }, 1800);
            return { ...a, status: 'executing' as ActionStatus };
          }),
        };
      }),
    );
  };

  const handleFeedback = (scnIdx: number, val: FeedbackValue) => {
    setScenarios((prev) =>
      prev.map((s, i) => (i !== scnIdx ? s : { ...s, feedback: s.feedback === val ? null : val })),
    );
  };

  const selected = modalIdx !== null ? (scenarios[modalIdx] ?? null) : null;
  const totalSignals = scenarios.reduce((a, s) => a + s.matchCount, 0);
  const highRisk = scenarios.filter((s) => s.risk === 'HIGH').length;
  const pendingActions = scenarios.reduce(
    (a, s) => a + s.suggestedActions.filter((x) => x.status === 'pending').length,
    0,
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#060a12',
        color: '#e2e8f0',
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
        padding: '28px 20px',
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0 auto 12px',
          padding: '10px 12px',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 8,
          background: 'rgba(245,158,11,0.08)',
          color: '#fde68a',
          fontSize: 12,
        }}
      >
        <strong>Prototype-Modus:</strong> keine echte Pipeline, kein echter Connector-Output.
        Aktionen und Agentenantworten sind simuliert.
      </div>

      <div
        style={{
          maxWidth: 920,
          margin: '0 auto 14px',
          padding: '10px 12px',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 8,
          background: 'rgba(34,197,94,0.08)',
          color: '#d1fae5',
          fontSize: 12,
        }}
      >
        <strong>Agent sagt:</strong> {simNote}
      </div>

      <div style={{ maxWidth: 920, margin: '0 auto 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 10px #22c55e',
              animation: 'pulse 2s infinite',
            }}
          />
          <span style={{ fontSize: 10, color: '#475569', letterSpacing: 3 }}>
            AGENT AKTIV · PARIS 2026 · {tick % 2 === 0 ? '▋' : ' '}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: '#f8fafc',
                margin: 0,
                letterSpacing: -1,
              }}
            >
              PWX Agent Console
            </h1>
            <p
              style={{
                fontSize: 12,
                color: '#475569',
                margin: '4px 0 0',
                fontFamily: 'sans-serif',
              }}
            >
              Der Agent priorisiert Szenarien, erklärt Zusammenhänge und schlägt konkrete Aktionen
              vor.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { label: 'JETZT HANDELN', value: highRisk, color: '#ef4444' },
              { label: 'OFFENE AKTIONEN', value: pendingActions, color: '#f59e0b' },
              { label: 'SIGNALE GESAMT', value: totalSignals, color: '#3b82f6' },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: '#334155', letterSpacing: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 920,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {scenarios.map((s, i) => {
          const risk = RISK_CONFIG[s.risk];
          const doneCount = s.suggestedActions.filter((a) => a.status === 'done').length;
          const pendCount = s.suggestedActions.filter((a) => a.status === 'pending').length;
          return (
            <div
              key={s.id}
              onClick={() => {
                setModalIdx(i);
                setActiveTab('signals');
              }}
              style={{
                background: '#0a0f1a',
                border: '1px solid #0f1929',
                borderLeft: `4px solid ${risk.color}`,
                borderRadius: 8,
                padding: '16px 18px',
                cursor: 'pointer',
                opacity: visible.includes(i) ? 1 : 0,
                transform: visible.includes(i) ? 'translateX(0)' : 'translateX(-10px)',
                transition: 'all 0.3s ease',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 16,
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 9,
                      background: risk.bg,
                      color: risk.color,
                      border: `1px solid ${risk.color}30`,
                      padding: '2px 8px',
                      borderRadius: 3,
                      letterSpacing: 1,
                      fontWeight: 700,
                    }}
                  >
                    {risk.label}
                  </span>
                  <span style={{ fontSize: 10, color: '#334155' }}>Konfidenz {s.confidence}%</span>
                  {s.crossLinks.length > 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        color: '#06b6d4',
                        background: 'rgba(6,182,212,0.1)',
                        border: '1px solid rgba(6,182,212,0.2)',
                        padding: '2px 7px',
                        borderRadius: 3,
                      }}
                    >
                      ⟷ {s.crossLinks.length} Verbindung{s.crossLinks.length > 1 ? 'en' : ''}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>
                  {s.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#64748b',
                    fontFamily: 'sans-serif',
                    marginBottom: 10,
                  }}
                >
                  {s.subtitle}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[...new Set(s.signals.map((sig) => sig.source))].map((src) => {
                    const c = SOURCE_COLORS[src] || { accent: '#64748b', label: src };
                    return (
                      <span
                        key={src}
                        style={{
                          fontSize: 9,
                          color: c.accent,
                          background: `${c.accent}15`,
                          border: `1px solid ${c.accent}25`,
                          padding: '2px 6px',
                          borderRadius: 3,
                        }}
                      >
                        {c.label}
                      </span>
                    );
                  })}
                  {pendCount > 0 && (
                    <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4 }}>
                      {pendCount} Aktion{pendCount > 1 ? 'en' : ''} offen
                    </span>
                  )}
                  {doneCount > 0 && (
                    <span style={{ fontSize: 10, color: '#22c55e' }}>✓ {doneCount} erledigt</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: risk.color, lineHeight: 1 }}>
                  {s.matchCount}
                </div>
                <div style={{ fontSize: 9, color: '#334155' }}>Signale</div>
                <div style={{ fontSize: 9, color: '#334155', marginTop: 2 }}>
                  {s.sources} Quellen
                </div>
                <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>Details →</div>
              </div>
            </div>
          );
        })}
      </div>

      {selected && modalIdx !== null && (
        <div
          onClick={() => setModalIdx(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6,10,18,0.88)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0a0f1a',
              border: '1px solid #1e293b',
              borderLeft: `4px solid ${RISK_CONFIG[selected.risk].color}`,
              borderRadius: 10,
              width: '100%',
              maxWidth: 700,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 6,
              }}
            >
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 9,
                      background: RISK_CONFIG[selected.risk].bg,
                      color: RISK_CONFIG[selected.risk].color,
                      border: `1px solid ${RISK_CONFIG[selected.risk].color}30`,
                      padding: '2px 8px',
                      borderRadius: 3,
                      fontWeight: 700,
                      letterSpacing: 1,
                    }}
                  >
                    {RISK_CONFIG[selected.risk].label}
                  </span>
                  <span style={{ fontSize: 10, color: '#475569' }}>
                    Konfidenz {selected.confidence}% · {selected.matchCount} Signale ·{' '}
                    {selected.sources} Quellen
                  </span>
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                  {selected.title}
                </h2>
                <p
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    margin: '3px 0 0',
                    fontFamily: 'sans-serif',
                  }}
                >
                  {selected.subtitle}
                </p>
              </div>
              <button
                onClick={() => setModalIdx(null)}
                style={{
                  background: 'none',
                  border: '1px solid #1e293b',
                  color: '#475569',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                margin: '12px 0 20px',
                padding: '10px 12px',
                background: '#080c14',
                border: '1px solid #0f1929',
                borderRadius: 6,
              }}
            >
              <span style={{ fontSize: 11, color: '#475569', fontFamily: 'sans-serif' }}>
                War diese Einschätzung hilfreich?
              </span>
              <button
                onClick={() => handleFeedback(modalIdx, 'up')}
                style={{
                  background: selected.feedback === 'up' ? 'rgba(34,197,94,0.15)' : 'none',
                  border: `1px solid ${selected.feedback === 'up' ? '#22c55e' : '#1e293b'}`,
                  color: selected.feedback === 'up' ? '#22c55e' : '#475569',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 14,
                  transition: 'all 0.2s',
                }}
              >
                👍
              </button>
              <button
                onClick={() => handleFeedback(modalIdx, 'down')}
                style={{
                  background: selected.feedback === 'down' ? 'rgba(239,68,68,0.15)' : 'none',
                  border: `1px solid ${selected.feedback === 'down' ? '#ef4444' : '#1e293b'}`,
                  color: selected.feedback === 'down' ? '#ef4444' : '#475569',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 14,
                  transition: 'all 0.2s',
                }}
              >
                👎
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 20,
                borderBottom: '1px solid #0f1929',
              }}
            >
              {(
                [
                  { id: 'signals', label: `Signale (${selected.signals.length})` },
                  { id: 'lyra', label: `Analyse (${selected.lyraInsights.length})` },
                  { id: 'crosslinks', label: `Verbindungen (${selected.crossLinks.length})` },
                  {
                    id: 'actions',
                    label: `Aktionen (${selected.suggestedActions.filter((a) => a.status === 'pending').length} offen)`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${activeTab === tab.id ? RISK_CONFIG[selected.risk].color : 'transparent'}`,
                    color: activeTab === tab.id ? '#f1f5f9' : '#475569',
                    cursor: 'pointer',
                    padding: '8px 14px 10px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    letterSpacing: 0.5,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'signals' && (
              <div>
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    background: 'rgba(34,197,94,0.06)',
                    border: '1px solid rgba(34,197,94,0.2)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontSize: 9, color: '#22c55e', letterSpacing: 2, marginBottom: 6 }}>
                    ▶ EMPFOHLENE MASSNAHME
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: '#d1fae5',
                      fontFamily: 'sans-serif',
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {selected.nextAction}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selected.signals.map((sig, i) => {
                    const c = SOURCE_COLORS[sig.source] || { accent: '#64748b', label: sig.source };
                    return (
                      <div
                        key={i}
                        style={{
                          background: `${c.accent}08`,
                          border: `1px solid ${c.accent}18`,
                          borderLeft: `2px solid ${c.accent}`,
                          borderRadius: 6,
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 4,
                          }}
                        >
                          <span style={{ fontSize: 10, color: c.accent, letterSpacing: 0.8 }}>
                            {c.label.toUpperCase()} · {sig.type}
                          </span>
                          <span style={{ fontSize: 10, color: '#334155' }}>
                            {relDays(sig.daysAgo)}
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: 12,
                            color: '#94a3b8',
                            fontFamily: 'sans-serif',
                            lineHeight: 1.5,
                            margin: 0,
                          }}
                        >
                          &ldquo;{sig.text}&rdquo;
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selected.implications.map((impl, i) => {
                    const cfg = IMPL_CONFIG[impl.type];
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          background: `${cfg.color}08`,
                          border: `1px solid ${cfg.color}18`,
                          borderRadius: 6,
                          padding: '9px 12px',
                        }}
                      >
                        <span style={{ color: cfg.color, fontSize: 14, flexShrink: 0 }}>
                          {cfg.icon}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: '#94a3b8',
                            fontFamily: 'sans-serif',
                            lineHeight: 1.5,
                          }}
                        >
                          {impl.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'lyra' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p
                  style={{
                    fontSize: 12,
                    color: '#475569',
                    fontFamily: 'sans-serif',
                    margin: '0 0 8px',
                  }}
                >
                  Der Agent analysiert nicht nur was passiert – sondern auch warum es bisher
                  übersehen wurde.
                </p>
                {selected.lyraInsights.map((ins, i) => {
                  const cfg = LYRA_CONFIG[ins.type];
                  return (
                    <div
                      key={i}
                      style={{
                        background: `${cfg.color}08`,
                        border: `1px solid ${cfg.color}20`,
                        borderRadius: 8,
                        padding: '14px',
                      }}
                    >
                      <div
                        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
                      >
                        <span style={{ color: cfg.color, fontSize: 16 }}>{cfg.icon}</span>
                        <span
                          style={{
                            fontSize: 9,
                            color: cfg.color,
                            letterSpacing: 1,
                            textTransform: 'uppercase',
                          }}
                        >
                          {cfg.label}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#e2e8f0',
                          marginBottom: 6,
                          fontFamily: 'sans-serif',
                        }}
                      >
                        {ins.question}
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          color: '#94a3b8',
                          fontFamily: 'sans-serif',
                          lineHeight: 1.6,
                          margin: 0,
                        }}
                      >
                        {ins.answer}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'crosslinks' && (
              <div>
                {selected.crossLinks.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#475569', fontFamily: 'sans-serif' }}>
                    Keine Querverbindungen erkannt.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p
                      style={{
                        fontSize: 12,
                        color: '#475569',
                        fontFamily: 'sans-serif',
                        margin: '0 0 8px',
                      }}
                    >
                      Diese Themen hängen zusammen. Wenn du hier handelst, solltest du auch dort
                      schauen.
                    </p>
                    {selected.crossLinks.map((link, i) => {
                      const rc = RELATION_CONFIG[link.relationStatus];
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            const idx = scenarios.findIndex((s) => s.id === link.scenarioId);
                            if (idx !== -1) {
                              setModalIdx(idx);
                              setActiveTab('signals');
                            }
                          }}
                          style={{
                            background: '#080c14',
                            border: `1px solid ${rc.color}25`,
                            borderLeft: `3px solid ${rc.color}`,
                            borderRadius: 8,
                            padding: '14px',
                            cursor: 'pointer',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 9,
                                color: rc.color,
                                background: `${rc.color}18`,
                                border: `1px solid ${rc.color}30`,
                                padding: '2px 7px',
                                borderRadius: 3,
                                letterSpacing: 1,
                              }}
                            >
                              {rc.label.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>
                              {link.title}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: '#64748b',
                              fontFamily: 'sans-serif',
                              marginBottom: 8,
                            }}
                          >
                            {link.subtitle}
                          </div>
                          <p
                            style={{
                              fontSize: 12,
                              color: '#94a3b8',
                              fontFamily: 'sans-serif',
                              lineHeight: 1.5,
                              margin: 0,
                            }}
                          >
                            {link.reason}
                          </p>
                          <div style={{ fontSize: 10, color: rc.color, marginTop: 8 }}>
                            → Szenario öffnen
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'actions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selected.suggestedActions.map((action) => {
                  const tc = TARGET_CONFIG[action.target] || {
                    color: '#64748b',
                    label: action.target,
                  };
                  return (
                    <div
                      key={action.id}
                      style={{
                        background: '#080c14',
                        border: `1px solid ${action.status === 'done' ? '#22c55e30' : action.status === 'rejected' ? '#ef444420' : action.status === 'executing' ? '#f59e0b30' : '#1e293b'}`,
                        borderRadius: 8,
                        padding: '14px',
                        opacity: action.status === 'rejected' ? 0.5 : 1,
                        transition: 'all 0.3s',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            color: tc.color,
                            background: `${tc.color}18`,
                            border: `1px solid ${tc.color}30`,
                            padding: '2px 7px',
                            borderRadius: 3,
                            letterSpacing: 1,
                          }}
                        >
                          {tc.label.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                          {action.label}
                        </span>
                        {action.status === 'done' && (
                          <span style={{ marginLeft: 'auto', color: '#22c55e', fontSize: 12 }}>
                            ✓ Erledigt
                          </span>
                        )}
                        {action.status === 'rejected' && (
                          <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 12 }}>
                            Abgelehnt
                          </span>
                        )}
                        {(action.status === 'executing' || executingId === action.id) && (
                          <span style={{ marginLeft: 'auto', color: '#f59e0b', fontSize: 12 }}>
                            Wird ausgeführt...
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          background: '#0a0f1a',
                          border: '1px solid #0f1929',
                          borderRadius: 5,
                          padding: '10px 12px',
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: '#334155',
                            marginBottom: 4,
                            letterSpacing: 1,
                          }}
                        >
                          VORSCHAU
                        </div>
                        <p
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            fontFamily: 'sans-serif',
                            lineHeight: 1.5,
                            margin: 0,
                          }}
                        >
                          {action.preview}
                        </p>
                      </div>
                      {action.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => handleAction(modalIdx, action.id, true)}
                            style={{
                              flex: 1,
                              background: 'rgba(34,197,94,0.1)',
                              border: '1px solid rgba(34,197,94,0.3)',
                              color: '#22c55e',
                              cursor: 'pointer',
                              padding: '8px',
                              borderRadius: 5,
                              fontSize: 12,
                              fontFamily: 'inherit',
                              fontWeight: 600,
                            }}
                          >
                            ✓ Ausführen
                          </button>
                          <button
                            onClick={() => handleAction(modalIdx, action.id, false)}
                            style={{
                              flex: 1,
                              background: 'rgba(239,68,68,0.08)',
                              border: '1px solid rgba(239,68,68,0.2)',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '8px',
                              borderRadius: 5,
                              fontSize: 12,
                              fontFamily: 'inherit',
                            }}
                          >
                            ✕ Ablehnen
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#060a12}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        button:hover{filter:brightness(1.2)}
      `}</style>
    </div>
  );
}
