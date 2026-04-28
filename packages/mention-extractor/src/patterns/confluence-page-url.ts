import type { MentionPattern } from './types';

/**
 * Confluence-Page-URL relativ-Pfad (typische Form in Slack-Bodies, auch in
 * E-Mails). Match-Gruppen: [1] space-key, [2] page-id.
 *
 * Page-URL kann auch ein Substring einer Comment-URL sein. Span-Tracking
 * im Matcher (sortiert nach Spezifität: Comment vor Page) löst das auf.
 */
export const confluencePageUrlPattern: MentionPattern = {
  name: 'confluence_page_url',
  regex: /\/wiki\/spaces\/([A-Z]+)\/pages\/(\d+)/g,
  confidence: 0.99,
  buildTargetId: (match) => `confluence:page:${match[2]}`,
};
