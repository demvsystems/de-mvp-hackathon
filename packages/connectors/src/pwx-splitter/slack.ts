import { SlackSnapshot } from '../slack/schema';
import { PwxContainer } from './types';

/**
 * Extrahiert die `slack`-Section eines Pwx-Containers und validiert sie
 * gegen `SlackSnapshot`. Da die pwx_ideen_*-Files Slack-Daten bereits im
 * Connector-konformen Format liefern, ist das im Pilot ein Validierungs-
 * Schritt — falls der Daten-Generator später vom Schema abweicht, schlägt
 * dieser Test früh an.
 */
export function extractSlackSnapshot(input: unknown): SlackSnapshot {
  const container = PwxContainer.parse(input);
  if (container.slack === undefined) {
    throw new Error(`PwxContainer "${container.cluster}" hat keine slack-section.`);
  }
  return SlackSnapshot.parse(container.slack);
}
