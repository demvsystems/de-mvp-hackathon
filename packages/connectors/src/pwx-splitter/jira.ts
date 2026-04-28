import { JiraSnapshot } from '../jira/schema';
import { PwxContainer } from './types';

/**
 * Extrahiert die `jira`-Section eines Pwx-Containers und validiert sie
 * gegen `JiraSnapshot`. Wie Slack ist die Section bereits weitgehend im
 * richtigen Schema; der Schritt fängt Drift im Generator früh ab.
 *
 * Eine Drift-Ausnahme: Pwx-Issues schreiben `sprintId: null` für
 * Backlog-Items, das Connector-Schema erwartet `undefined` (optional).
 * Wir normalisieren null→entfallen, damit der Strict-Parse durchläuft.
 */
export function extractJiraSnapshot(input: unknown): JiraSnapshot {
  const container = PwxContainer.parse(input);
  if (container.jira === undefined) {
    throw new Error(`PwxContainer "${container.cluster}" hat keine jira-section.`);
  }
  return JiraSnapshot.parse(normalizeJiraSection(container.jira));
}

function normalizeJiraSection(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const section = raw as Record<string, unknown>;
  const issues = Array.isArray(section['issues'])
    ? (section['issues'] as Array<Record<string, unknown>>).map(normalizeIssue)
    : section['issues'];
  return { ...section, issues };
}

function normalizeIssue(issue: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...issue };
  if (out['sprintId'] === null) delete out['sprintId'];
  return out;
}
