import { confluenceCommentUrlPattern } from './confluence-comment-url';
import { confluencePageUrlPattern } from './confluence-page-url';
import { githubIssueShortformPattern } from './github-issue-shortform';
import { githubIssueUrlPattern } from './github-issue-url';
import { githubPrUrlPattern } from './github-pr-url';
import { jiraHashtagPattern } from './jira-hashtag';
import { jiraKeyPattern } from './jira-key';
import { slackPermalinkPattern } from './slack-permalink';

export type { MentionPattern, MentionMatch } from './types';

/**
 * Pattern-Registry, sortiert nach Spezifität (am spezifischsten zuerst).
 * Der Matcher läuft sequentiell durch und überspringt Bereiche, die
 * schon konsumiert wurden — so gewinnt das spezifischere Pattern, wenn
 * sich Match-Spans überlappen.
 *
 * Reihenfolge-Begründung:
 * - URLs vor Shortforms vor freien Keys (URL-Substrings können einen Key
 *   "wie" matchen, würde aber doppelte Edges erzeugen)
 * - confluence_comment_url ⊃ confluence_page_url (Comment ist Page + Anchor)
 * - jira_hashtag ⊃ jira_key (Hashtag ist Key mit `#`-Prefix)
 */
export const ALL_PATTERNS = [
  // URL-Patterns (höchste Spezifität, längste Match-Spans)
  confluenceCommentUrlPattern,
  confluencePageUrlPattern,
  githubPrUrlPattern,
  githubIssueUrlPattern,
  slackPermalinkPattern,
  // Shortforms und prefix-getragene Patterns
  githubIssueShortformPattern,
  jiraHashtagPattern,
  // Freie Keys zuletzt
  jiraKeyPattern,
] as const;
