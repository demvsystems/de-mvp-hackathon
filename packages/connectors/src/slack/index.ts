import type { ConnectorSpec } from '../core';
import { handleRow } from './handle';
import type { SlackRow } from './schema';

export const slackConnector: ConnectorSpec<SlackRow> = {
  name: 'slack',
  files: {
    workspace: 'workspaces.jsonl',
    channel: 'channels.jsonl',
    user: 'users.jsonl',
    message: 'messages.jsonl',
  },
  handleRow,
};

export { handleRow } from './handle';
export * from './schema';
export * as slackIds from './ids';
