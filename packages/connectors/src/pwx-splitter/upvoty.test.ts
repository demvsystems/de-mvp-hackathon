import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractUpvotySnapshot } from './upvoty';

const PWX_BIPRO = join(process.cwd(), '../../apps/playground/Dummyfiles/pwx_ideen_bipro.json');

async function loadBipro(): Promise<unknown> {
  return JSON.parse(await readFile(PWX_BIPRO, 'utf8')) as unknown;
}

describe('extractUpvotySnapshot', () => {
  it('konvertiert einen Post mit author-Objekt in UpvotyPost mit author_id', () => {
    const snapshot = extractUpvotySnapshot({
      cluster: 'foo',
      upvoty: {
        posts: [
          {
            id: 'post_1',
            title: 'A',
            description: 'B',
            status: 'open',
            board_id: 'board_x',
            author: { id: 'u_1', name: 'Alice' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        comments: [],
        votes: [],
      },
    });
    expect(snapshot.posts).toHaveLength(1);
    const p = snapshot.posts[0]!;
    expect(p.id).toBe('post_1');
    expect(p.body).toBe('B');
    expect(p.author_id).toBe('u_1');
    expect(p.created_at).toBe('2026-04-15T08:00:00.000Z');
    expect(p.board_id).toBe('board_x');
  });

  it('embedded Comments dem zugehörigen Post via post_id', () => {
    const snapshot = extractUpvotySnapshot({
      cluster: 'foo',
      upvoty: {
        posts: [
          {
            id: 'post_1',
            title: 'A',
            description: 'B',
            status: 'open',
            board_id: 'b',
            author: { id: 'u_1', name: 'Alice' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        comments: [
          {
            id: 'c_1',
            post_id: 'post_1',
            user_id: 'u_2',
            body: 'comment',
            createdAt: '2026-04-15T09:00:00.000Z',
            updatedAt: '2026-04-15T09:00:00.000Z',
          },
        ],
        votes: [],
      },
    });
    const p = snapshot.posts[0]!;
    expect(p.comments).toHaveLength(1);
    expect(p.comments[0]!.author_id).toBe('u_2');
    expect(p.comments[0]!.body).toBe('comment');
  });

  it('aggregiert Votes pro Post in voter_ids und vote_count', () => {
    const snapshot = extractUpvotySnapshot({
      cluster: 'foo',
      upvoty: {
        posts: [
          {
            id: 'post_1',
            title: 'A',
            description: 'B',
            status: 'open',
            board_id: 'b',
            author: { id: 'u_1', name: 'Alice' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        comments: [],
        votes: [
          {
            id: 'v_1',
            post_id: 'post_1',
            user_id: 'u_3',
            value: 1,
            createdAt: '...',
            updatedAt: '...',
          },
          {
            id: 'v_2',
            post_id: 'post_1',
            user_id: 'u_4',
            value: 1,
            createdAt: '...',
            updatedAt: '...',
          },
        ],
      },
    });
    const p = snapshot.posts[0]!;
    expect(p.vote_count).toBe(2);
    expect(p.voter_ids.sort()).toEqual(['u_3', 'u_4']);
  });

  it('leitet Boards aus distinct post.board_id ab', () => {
    const snapshot = extractUpvotySnapshot({
      cluster: 'foo',
      upvoty: {
        posts: [
          {
            id: 'p1',
            title: '1',
            description: '',
            status: 'open',
            board_id: 'b_a',
            author: { id: 'u_1', name: 'A' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
          {
            id: 'p2',
            title: '2',
            description: '',
            status: 'open',
            board_id: 'b_b',
            author: { id: 'u_1', name: 'A' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        comments: [],
        votes: [],
      },
    });
    expect(snapshot.boards.map((b) => b.id).sort()).toEqual(['b_a', 'b_b']);
  });

  it('sammelt Users aus author, comment.user_id und vote.user_id', () => {
    const snapshot = extractUpvotySnapshot({
      cluster: 'foo',
      upvoty: {
        posts: [
          {
            id: 'p1',
            title: '1',
            description: '',
            status: 'open',
            board_id: 'b',
            author: { id: 'u_author', name: 'Author' },
            createdAt: '2026-04-15T08:00:00.000Z',
            updatedAt: '2026-04-15T08:00:00.000Z',
          },
        ],
        comments: [
          {
            id: 'c1',
            post_id: 'p1',
            user_id: 'u_commenter',
            body: 'x',
            createdAt: '2026-04-15T09:00:00.000Z',
            updatedAt: '2026-04-15T09:00:00.000Z',
          },
        ],
        votes: [
          {
            id: 'v1',
            post_id: 'p1',
            user_id: 'u_voter',
            value: 1,
            createdAt: '...',
            updatedAt: '...',
          },
        ],
      },
    });
    const userIds = snapshot.users.map((u) => u.id).sort();
    expect(userIds).toEqual(['u_author', 'u_commenter', 'u_voter']);
  });

  it('akzeptiert die echte pwx_ideen_bipro upvoty-section', async () => {
    const container = await loadBipro();
    const snapshot = extractUpvotySnapshot(container);
    expect(snapshot.posts.length).toBeGreaterThan(0);
    expect(snapshot.boards.length).toBeGreaterThan(0);
    expect(snapshot.users.length).toBeGreaterThan(0);
  });

  it('wirft, wenn der Container keine upvoty-section hat', () => {
    expect(() => extractUpvotySnapshot({ cluster: 'foo' })).toThrow(/upvoty/i);
  });
});
