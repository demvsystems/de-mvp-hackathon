import type { MentionPattern } from './types';

/**
 * Jira-Key in Hashtag-Form (`#DEMV-4127`). In Slack-Diskussionen üblich,
 * weil GitHub-/Linear-Issue-Verweise denselben Stil benutzen — Slack-User
 * gewöhnen sich daran und nutzen es auch für Jira.
 *
 * Niedrigere Confidence (0.93) als das Standard-Jira-Pattern, weil ein
 * `#`-prefix in Code/URL-Fragments False Positives liefern kann.
 *
 * Der Resolver braucht denselben DB-Lookup wie jira_key (Key → numerische
 * Issue-ID); im Pilot ohne Resolver-Anbindung liefert das Pattern null.
 */
export const jiraHashtagPattern: MentionPattern = {
  name: 'jira_hashtag',
  regex: /#([A-Z][A-Z0-9]+)-(\d+)\b/g,
  confidence: 0.93,
  buildTargetId: () => null,
};
