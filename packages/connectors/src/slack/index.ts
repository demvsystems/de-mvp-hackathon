import { JsonSnapshotSource, type ConnectorSpec } from '../core';
import { map } from './handle';
import type { SlackSnapshot } from './schema';

/**
 * Slack-Connector: liest einen Channel-Snapshot (genested mit Threads) aus
 * `<dir>/slack.json` und mappt ihn auf Records + Edges.
 */
export const slackConnector: ConnectorSpec<SlackSnapshot> = {
  name: 'slack',
  read: (dir) => JsonSnapshotSource.at<SlackSnapshot>(dir, 'slack.json'),
  map,
};

export { map } from './handle';
export * from './schema';
export * as slackIds from './ids';
