import type { MentionPattern } from './types';

/**
 * Vollständige GitHub-PR-URL. Identisch konstruiert zu Issue-URL, aber
 * `/pull/`-Pfadsegment unterscheidet — ergibt unterschiedliche Target-IDs
 * (`github:pr:...` vs `github:issue:...`).
 */
export const githubPrUrlPattern: MentionPattern = {
  name: 'github_pr_url',
  regex: /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g,
  confidence: 0.99,
  buildTargetId: (match) => `github:pr:${match[1]}/${match[2]}/${match[3]}`,
};
