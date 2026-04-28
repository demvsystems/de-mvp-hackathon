import type { MentionPattern } from './types';

/**
 * Vollständige GitHub-Issue-URL. Eindeutiges Pattern, höchste Confidence —
 * Resolver braucht keinen DB-Lookup, weil Owner, Repo und Issue-Nummer
 * direkt im Match stehen.
 */
export const githubIssueUrlPattern: MentionPattern = {
  name: 'github_issue_url',
  regex: /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/g,
  confidence: 0.99,
  buildTargetId: (match) => `github:issue:${match[1]}/${match[2]}/${match[3]}`,
};
