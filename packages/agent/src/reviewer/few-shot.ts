import type { ActionPlan } from '../shared/action-plan';

export const DEFAULT_ACTION_PLAN_FEW_SHOTS: ReadonlyArray<ActionPlan> = [
  {
    rationale:
      'Mehrere Quellen bestätigen denselben Checkout-Bug. Engineering braucht ein strukturiertes Jira-Ticket, betroffene Kunden brauchen ein direktes Update, und das Produkt-/Engineering-Team braucht einen verlinkten Slack-Hinweis im Discovery-Thread.',
    actions: [
      {
        kind: 'create_jira_ticket',
        project: 'SHOP',
        issue_type: 'Bug',
        title: 'Checkout 502 bei Firmenkreditkarte blockiert Bestellungen',
        body: 'Mehrere Quellen bestätigen einen blockierenden Checkout-Fehler bei Firmenkreditkarten. Bitte Reproduktion, Scope, betroffene Zahlungsarten und kurzfristige Mitigation dokumentieren.',
        labels: ['checkout', 'billing', 'customer-impact'],
      },
      {
        kind: 'reply_intercom',
        conversation_record_id: 'intercom:conversation:conv_example_bug',
        body: 'Danke für die Meldung. Wir haben das Problem an unser Engineering-Team eskaliert und halten Sie auf dem Laufenden, sobald es ein Update gibt.',
      },
      {
        kind: 'post_slack_message',
        channel: '#bugs',
        body: 'Neuer bestätigter Checkout-Bug: Firmenkreditkarten laufen in einen 502. Jira: SHOP-000. Intercom-Fall ist verknüpft; bitte Priorisierung prüfen.',
        placement: {
          mode: 'thread',
          thread_root_record_id: 'slack:msg:workspace/CBUGS/1715000000.000001',
        },
      },
    ],
    cross_references: [
      { from_action_idx: 1, to_action_idx: 0, type: 'mentions' },
      { from_action_idx: 2, to_action_idx: 0, type: 'mentions' },
    ],
  },
  {
    rationale:
      'Ein Feature-Request ist über mehrere Quellen konsistent und sollte als Story aggregiert werden. Slack bekommt eine kurze Zusammenfassung mit Verweis auf das Jira-Ticket.',
    actions: [
      {
        kind: 'create_jira_ticket',
        project: 'SHOP',
        issue_type: 'Story',
        title: 'Verbesserungsidee für flexiblere Checkout-Freigaben bündeln',
        body: 'Mehrere Kunden und interne Teams fragen nach derselben Verbesserung. Bitte Scope, Nutzen, betroffene Personas und Akzeptanzkriterien als Story ausarbeiten.',
        labels: ['feature-request', 'checkout'],
      },
      {
        kind: 'post_slack_message',
        channel: '#product',
        body: 'Gebündelter Feature-Request für Checkout-Freigaben angelegt: SHOP-000. Mehrere Quellen zeigen konsistenten Bedarf; Details stehen im Ticket.',
        placement: { mode: 'channel' },
      },
    ],
    cross_references: [{ from_action_idx: 1, to_action_idx: 0, type: 'mentions' }],
  },
];
