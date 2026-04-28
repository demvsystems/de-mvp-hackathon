import { JsonSnapshotSource, type ConnectorSpec } from '../core';
import { map } from './handle';
import type { UpvotySnapshot } from './schema';

/**
 * Upvoty-Connector (Skelett). Wartet auf reale Mocks; das Schema folgt der
 * Upvoty-API-Form (Boards, Posts mit Comments, User die voten).
 */
export const upvotyConnector: ConnectorSpec<UpvotySnapshot> = {
  name: 'upvoty',
  read: (dir) => JsonSnapshotSource.at<UpvotySnapshot>(dir, 'upvoty.json'),
  map,
};

export { map } from './handle';
export * from './schema';
export * as upvotyIds from './ids';
