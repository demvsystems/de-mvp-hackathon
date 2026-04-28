import { makeRecordId } from '../core';

export const SOURCE = 'slack';

/**
 * Workspace-Default. Der aktuelle Mock liefert keine `team_id`; sobald die
 * Mock-Lieferung das ergänzt, wird der Default überflüssig. Wir halten ihn
 * konstant, damit IDs deterministisch und re-runbar bleiben.
 */
export const DEFAULT_WORKSPACE = 'hackathon';

export function workspaceId(workspace: string = DEFAULT_WORKSPACE): string {
  return makeRecordId(SOURCE, 'workspace', workspace);
}

export function channelId(channel: string, workspace: string = DEFAULT_WORKSPACE): string {
  return makeRecordId(SOURCE, 'channel', workspace, channel);
}

export function userId(user: string, workspace: string = DEFAULT_WORKSPACE): string {
  return makeRecordId(SOURCE, 'user', workspace, user);
}

export function messageId(
  channel: string,
  slackTs: string,
  workspace: string = DEFAULT_WORKSPACE,
): string {
  return makeRecordId(SOURCE, 'msg', workspace, channel, slackTs);
}
