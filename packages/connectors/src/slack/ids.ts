import { makeRecordId } from '../core';

export const SOURCE = 'slack';

export function workspaceId(teamId: string): string {
  return makeRecordId(SOURCE, 'workspace', teamId);
}

export function channelId(teamId: string, channelId: string): string {
  return makeRecordId(SOURCE, 'channel', teamId, channelId);
}

export function userId(teamId: string, userId: string): string {
  return makeRecordId(SOURCE, 'user', teamId, userId);
}

export function messageId(teamId: string, channelId: string, ts: string): string {
  return makeRecordId(SOURCE, 'msg', teamId, channelId, ts);
}
