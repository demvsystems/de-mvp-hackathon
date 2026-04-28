import type { MentionPattern } from './types';

/**
 * Slack-Permalink-Format: `https://<workspace>.slack.com/archives/<channel>/p<ts-without-dot>`.
 *
 * Match-Gruppen: [1] channel-id (C... oder G...), [2] timestamp ohne Punkt.
 * Der Resolver muss aus Workspace-Subdomain und ts den vollen subject_id
 * `slack:msg:<workspace>/<channel>/<ts>` bauen — das ist im Pilot ohne
 * verfügbaren Workspace-Lookup nicht trivial, daher liefert das Pattern
 * vorerst null. Schritt #5 hängt einen echten Resolver an.
 */
export const slackPermalinkPattern: MentionPattern = {
  name: 'slack_permalink',
  regex: /https:\/\/[\w.-]+\.slack\.com\/archives\/([CG]\w+)\/p(\d+)/g,
  confidence: 0.99,
  buildTargetId: () => null,
};
