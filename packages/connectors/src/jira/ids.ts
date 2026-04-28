import { makeRecordId } from '../core';

export const SOURCE = 'jira';

/**
 * Z2 sagt: für Project und Issue ist im Pilot der Key (`SHOP`, `SHOP-142`)
 * ausreichend. In Produktion würde man die numerische ID nehmen, weil Keys
 * sich bei Project-Moves ändern können.
 */
export function projectId(key: string): string {
  return makeRecordId(SOURCE, 'project', key);
}

export function boardId(id: number): string {
  return makeRecordId(SOURCE, 'board', String(id));
}

export function sprintId(id: number): string {
  return makeRecordId(SOURCE, 'sprint', String(id));
}

export function issueId(key: string): string {
  return makeRecordId(SOURCE, 'issue', key);
}

/** Synthetische Comment-ID (`SHOP-142/c0`) — Mock liefert keine eigene ID. */
export function commentId(issueKey: string, index: number): string {
  return makeRecordId(SOURCE, 'comment', issueKey, `c${index}`);
}
