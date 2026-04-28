import type { MentionPattern } from './types';

/**
 * Confluence-Comment-URL: Page-URL mit `#comment-<id>` Anchor. Spezifischer
 * als Page-URL, daher sortiert der Matcher dieses Pattern davor (Span-
 * Tracking verhindert dann doppelte Edges).
 */
export const confluenceCommentUrlPattern: MentionPattern = {
  name: 'confluence_comment_url',
  regex: /\/wiki\/spaces\/[A-Z]+\/pages\/\d+[^#\s]*#comment-(\d+)/g,
  confidence: 0.99,
  buildTargetId: (match) => `confluence:comment:${match[1]}`,
};
