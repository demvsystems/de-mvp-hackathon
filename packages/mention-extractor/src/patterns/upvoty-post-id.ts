import type { MentionPattern } from './types';

/**
 * Upvoty-Post-ID, wie sie in Cross-Channel-Erwähnungen auftaucht (z.B.
 * Slack: "Upvoty post_2001"). Word-Boundaries verhindern Treffer mitten in
 * zusammengesetzten Tokens.
 *
 * Annahme zur ID-Form: die Fixtures verwenden `post_<digits>` als kanonische
 * Post-ID — derselbe Token taucht im natürlichsprachlichen Verweis und im
 * `subject_id` (`upvoty:post:post_2001`) auf. Bei realen Upvoty-IDs (oft
 * numerisch oder hex) muss das Pattern nachgezogen werden.
 *
 * Confidence 0.93: `post_` ist ein generischeres Prefix als `conv_`,
 * deshalb minimal niedriger. Ziffern-Suffix mit Word-Boundary macht
 * False Positives trotzdem selten.
 */
export const upvotyPostIdPattern: MentionPattern = {
  name: 'upvoty_post_id',
  regex: /\bpost_\d+\b/g,
  confidence: 0.93,
  buildTargetId: (match) => `upvoty:post:${match[0]}`,
};
