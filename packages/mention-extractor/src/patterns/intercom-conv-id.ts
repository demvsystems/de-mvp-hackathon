import type { MentionPattern } from './types';

/**
 * Intercom-Conversation-ID, wie sie in Cross-Channel-Erwähnungen auftaucht
 * (z.B. Slack-Messages, die "Intercom conv_9001" zitieren). Word-Boundaries
 * verhindern Treffer mitten in zusammengesetzten Tokens.
 *
 * Annahme zur ID-Form: die Fixtures verwenden `conv_<digits>` als kanonische
 * Conversation-ID — derselbe Token taucht im natürlichsprachlichen Verweis
 * und im `subject_id` (`intercom:conversation:conv_9001`) auf. Bei realen
 * Intercom-IDs (rein numerisch) muss das Pattern nachgezogen werden.
 *
 * Confidence 0.95: snake_case mit Ziffern-Suffix ist sehr selten zufällig.
 */
export const intercomConvIdPattern: MentionPattern = {
  name: 'intercom_conv_id',
  regex: /\bconv_\d+\b/g,
  confidence: 0.95,
  buildTargetId: (match) => `intercom:conversation:${match[0]}`,
};
