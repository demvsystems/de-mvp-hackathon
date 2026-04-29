import { z } from 'zod';

export const Playbook = z.object({
  slack: z.object({
    channels: z.object({
      bug: z.string(),
      feature: z.string(),
      default: z.string(),
    }),
    placement_default: z.enum(['thread', 'channel']),
    always_mention_jira_in_slack: z.boolean(),
  }),
  jira: z.object({
    bug: z.object({
      project: z.string(),
      issue_type: z.string(),
      default_labels: z.array(z.string()),
    }),
    feature: z.object({
      project: z.string(),
      issue_type: z.string(),
      default_labels: z.array(z.string()),
    }),
  }),
  intercom: z.object({
    reply_for_confirmed_bugs: z.boolean(),
    include_jira_key_in_reply: z.boolean(),
    internal_note_for_unconfirmed: z.boolean(),
    tone: z.string(),
  }),
  cross_reference_rules: z.object({
    always: z.array(z.string()),
    never: z.array(z.string()),
  }),
  tone: z.object({
    slack: z.string(),
    intercom: z.string(),
    jira: z.string(),
  }),
  freeform_notes: z.string(),
});
export type Playbook = z.infer<typeof Playbook>;

export const PLAYBOOK_ID = 'default';
export const DEFAULT_PLAYBOOK: Playbook = {
  slack: {
    channels: {
      bug: '#bugs',
      feature: '#product',
      default: '#general',
    },
    placement_default: 'thread',
    always_mention_jira_in_slack: true,
  },
  jira: {
    bug: {
      project: 'SHOP',
      issue_type: 'Bug',
      default_labels: [],
    },
    feature: {
      project: 'SHOP',
      issue_type: 'Story',
      default_labels: [],
    },
  },
  intercom: {
    reply_for_confirmed_bugs: true,
    include_jira_key_in_reply: false,
    internal_note_for_unconfirmed: true,
    tone: 'freundlich, lösungsorientiert, ohne Schuldzuweisung',
  },
  cross_reference_rules: {
    always: ['slack→jira mentions', 'intercom→jira mentions'],
    never: ['intercom→slack mentions'],
  },
  tone: {
    slack: 'knapp, fakt-orientiert, mit IDs',
    intercom: 'freundlich, lösungsorientiert, ohne interne Details',
    jira: 'präzise, mit Reproduktionsschritten und Akzeptanzkriterien',
  },
  freeform_notes:
    'Bei mehrfach bestätigten Bugs immer ein Jira-Ticket öffnen UND betroffene Kunden via Intercom benachrichtigen UND das Engineering-Team in Slack informieren. Wenn es einen Slack-Discovery-Thread gibt, Slack-Update als Reply in den Thread, sonst dedizierter Channel-Post.',
};

export function renderPlaybookForPrompt(p: Playbook): string {
  return `# Company Playbook (autoritativ)

## Slack
- Bug-Channel: ${p.slack.channels.bug}
- Feature-Channel: ${p.slack.channels.feature}
- Default-Channel: ${p.slack.channels.default}
- Platzierung Default: ${p.slack.placement_default} (wenn Discovery-Message existiert → thread; sonst dedizierter Channel)
- Jira-Key in Slack-Posts immer erwähnen: ${p.slack.always_mention_jira_in_slack ? 'ja' : 'nein'}
- Tonalität: ${p.tone.slack}

## Jira
- Bug:     project=${p.jira.bug.project}, issue_type=${p.jira.bug.issue_type}, default_labels=${JSON.stringify(p.jira.bug.default_labels)}
- Feature: project=${p.jira.feature.project}, issue_type=${p.jira.feature.issue_type}, default_labels=${JSON.stringify(p.jira.feature.default_labels)}
- Tonalität: ${p.tone.jira}

## Intercom
- Reply bei bestätigtem Bug: ${p.intercom.reply_for_confirmed_bugs ? 'ja' : 'nein'}
- Jira-Key in Intercom-Reply einbinden: ${p.intercom.include_jira_key_in_reply ? 'ja' : 'nein'}
- Interne Notiz bei unbestätigten Fällen: ${p.intercom.internal_note_for_unconfirmed ? 'ja' : 'nein'}
- Tonalität: ${p.intercom.tone}

## Cross-Reference-Regeln
- Pflicht: ${p.cross_reference_rules.always.join('; ') || '(keine)'}
- Verboten: ${p.cross_reference_rules.never.join('; ') || '(keine)'}

## Freitext-Notizen
${p.freeform_notes}`;
}
