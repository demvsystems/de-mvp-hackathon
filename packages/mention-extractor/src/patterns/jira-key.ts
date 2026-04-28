import type { MentionPattern } from './types';

/**
 * Klassisches Jira-Key-Format: PROJECTKEY-NUMBER. Word-Boundaries auf
 * beiden Seiten verhindern False Positives in Pfaden, Variablennamen
 * und URL-Substrings.
 *
 * Eine vollständige Slack-Permalink-URL enthält keinen Key in dem Sinn —
 * sie hat ein anderes Pattern (`/archives/<channel>/p<ts>`). Damit
 * kollidieren wir nicht.
 *
 * Confidence 0.95: Pattern ist sehr eindeutig, aber nicht eindeutig wie
 * eine vollständige URL — gelegentlich tauchen Code-Tokens wie `UTF-8`
 * auf, die gegen das Pattern matchen, aber nicht gemeint sind.
 *
 * `buildTargetId` ist im Pilot ohne Resolver-Anbindung implementiert und
 * liefert immer `null`. Der Worker übergibt später eine Pattern-Factory
 * mit injiziertem Resolver — siehe Schritt #5 (Resolver) und #6 (pending).
 */
export const jiraKeyPattern: MentionPattern = {
  name: 'jira_key',
  regex: /\b([A-Z][A-Z0-9]+)-(\d+)\b/g,
  confidence: 0.95,
  buildTargetId: () => null,
};
