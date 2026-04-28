import { JsonSnapshotSource, type ConnectorSpec } from '../core';
import { map } from './handle';
import type { JiraSnapshot } from './schema';

/**
 * Jira-Connector: liest einen Snapshot aus `<dir>/jira.json` und mappt
 * Projekte, Boards, Sprints und Issues auf Records + Edges.
 */
export const jiraConnector: ConnectorSpec<JiraSnapshot> = {
  name: 'jira',
  read: (dir) => JsonSnapshotSource.at<JiraSnapshot>(dir, 'jira.json'),
  map,
};

export { map } from './handle';
export * from './schema';
export * as jiraIds from './ids';
