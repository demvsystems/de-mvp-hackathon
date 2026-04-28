import { makeRecordId } from '../core';

export const SOURCE = 'upvoty';

export function boardId(id: string): string {
  return makeRecordId(SOURCE, 'board', id);
}

export function userId(id: string): string {
  return makeRecordId(SOURCE, 'user', id);
}

export function postId(id: string): string {
  return makeRecordId(SOURCE, 'post', id);
}

export function commentId(post: string, comment: string): string {
  return makeRecordId(SOURCE, 'comment', post, comment);
}
