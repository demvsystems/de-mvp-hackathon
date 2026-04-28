import type { MentionPattern } from './types';

/**
 * GitHub-Shortform `owner/repo#number`. Niedrigere Confidence als URL-
 * Patterns, weil das Format auch in Code/Pfaden auftauchen kann — aber
 * der `#`-Anker mit Zahl direkt dahinter ist relativ eindeutig.
 *
 * Spec sagt 0.97 — sehr eindeutig, aber nicht so eindeutig wie volle URL.
 */
export const githubIssueShortformPattern: MentionPattern = {
  name: 'github_issue_shortform',
  regex: /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g,
  confidence: 0.97,
  buildTargetId: (match) => `github:issue:${match[1]}/${match[2]}/${match[3]}`,
};
