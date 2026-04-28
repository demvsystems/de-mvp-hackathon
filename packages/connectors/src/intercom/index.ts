import { JsonSnapshotSource, type ConnectorSpec } from '../core';
import { map } from './handle';
import type { IntercomSnapshot } from './schema';

/**
 * Intercom-Connector (Skelett). Wartet auf reale Mocks; das Schema folgt
 * der Intercom-API-Form (Conversations mit Parts, Contacts, Agents).
 */
export const intercomConnector: ConnectorSpec<IntercomSnapshot> = {
  name: 'intercom',
  read: (dir) => JsonSnapshotSource.at<IntercomSnapshot>(dir, 'intercom.json'),
  map,
};

export { map } from './handle';
export * from './schema';
export * as intercomIds from './ids';
