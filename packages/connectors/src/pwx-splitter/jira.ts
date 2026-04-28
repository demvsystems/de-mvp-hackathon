import { JiraSnapshot } from '../jira/schema';
import { PwxContainer } from './types';

/**
 * Extrahiert die `jira`-Section eines Pwx-Containers und validiert sie
 * gegen `JiraSnapshot`. Wie Slack ist die Section bereits im richtigen
 * Schema; der Schritt fängt Drift im Generator früh ab.
 */
export function extractJiraSnapshot(input: unknown): JiraSnapshot {
  const container = PwxContainer.parse(input);
  if (container.jira === undefined) {
    throw new Error(`PwxContainer "${container.cluster}" hat keine jira-section.`);
  }
  return JiraSnapshot.parse(container.jira);
}
