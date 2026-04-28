import { z } from 'zod';

/**
 * Pwx-Cluster-Container: enthält pro Source eine eigene Section, jeweils
 * im Format der jeweiligen Source-API. Slack/Jira sind direkt als
 * Snapshot brauchbar, Intercom kommt im Webhook-Event-Format und Upvoty
 * mit separaten posts/comments/votes-Listen — die Adapter konvertieren
 * sie ins Snapshot-Schema des jeweiligen Connectors.
 *
 * Schema absichtlich locker (`unknown` statt strikt), damit der Splitter
 * pwx_ideen_*-Files akzeptiert, auch wenn nicht alle Sections vollständig
 * sind — fehlende Sections liefern leere Snapshots.
 */
export const PwxContainer = z.object({
  cluster: z.string(),
  scenario_id: z.string().optional(),
  slack: z.unknown().optional(),
  jira: z.unknown().optional(),
  intercom: z.unknown().optional(),
  upvoty: z.unknown().optional(),
});
export type PwxContainer = z.infer<typeof PwxContainer>;
