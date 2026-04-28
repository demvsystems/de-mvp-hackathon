import {
  UpvotyBoard,
  UpvotyComment,
  UpvotyPost,
  UpvotySnapshot,
  UpvotyUser,
} from '../upvoty/schema';
import { PwxContainer } from './types';

/**
 * Konvertiert die `upvoty`-Section eines Pwx-Containers in ein
 * `UpvotySnapshot`. Format-Drift gegenüber dem Connector:
 *
 * - Pwx-Posts haben `author: {id, name}`, der Connector erwartet `author_id`
 * - Pwx-Posts haben `description`, der Connector `body`
 * - Pwx-Posts haben `createdAt` (camelCase), der Connector `created_at`
 * - Comments stehen separat in `comments[]` mit `user_id` — der Connector
 *   embedded Comments im Post mit `author_id`
 * - Votes stehen separat — der Connector aggregiert sie zu `vote_count` und
 *   `voter_ids` pro Post
 *
 * Boards und Users werden aus Posts/Comments/Votes abgeleitet, weil der
 * Pwx-Container sie nicht eigenständig auflistet.
 */
export function extractUpvotySnapshot(input: unknown): UpvotySnapshot {
  const container = PwxContainer.parse(input);
  if (container.upvoty === undefined) {
    throw new Error(`PwxContainer "${container.cluster}" hat keine upvoty-section.`);
  }
  const section = container.upvoty as {
    posts?: unknown[];
    comments?: unknown[];
    votes?: unknown[];
  };

  const rawPosts = Array.isArray(section.posts) ? (section.posts as RawPost[]) : [];
  const rawComments = Array.isArray(section.comments) ? (section.comments as RawComment[]) : [];
  const rawVotes = Array.isArray(section.votes) ? (section.votes as RawVote[]) : [];

  const commentsByPost = new Map<string, UpvotyComment[]>();
  for (const c of rawComments) {
    const list = commentsByPost.get(c.post_id) ?? [];
    list.push(
      UpvotyComment.parse({
        id: c.id,
        body: c.body,
        created_at: c.createdAt,
        author_id: c.user_id,
      }),
    );
    commentsByPost.set(c.post_id, list);
  }

  const votersByPost = new Map<string, Set<string>>();
  for (const v of rawVotes) {
    const set = votersByPost.get(v.post_id) ?? new Set<string>();
    set.add(v.user_id);
    votersByPost.set(v.post_id, set);
  }

  const posts: UpvotyPost[] = rawPosts.map((p) => {
    const voters = votersByPost.get(p.id) ?? new Set<string>();
    return UpvotyPost.parse({
      id: p.id,
      title: p.title,
      body: p.description ?? null,
      status: p.status,
      board_id: p.board_id,
      author_id: p.author.id,
      created_at: p.createdAt,
      vote_count: voters.size,
      voter_ids: Array.from(voters),
      comments: commentsByPost.get(p.id) ?? [],
    });
  });

  // Boards aus distinct board_ids ableiten — Pwx liefert keine board-Records.
  const boardIds = new Set<string>(rawPosts.map((p) => p.board_id));
  const boards: UpvotyBoard[] = Array.from(boardIds).map((id) =>
    UpvotyBoard.parse({ id, name: id }),
  );

  // Users aus allen bekannten Quellen sammeln. Author bringt Namen mit;
  // Comment- und Vote-User kennen wir nur per ID.
  const users = new Map<string, UpvotyUser>();
  for (const p of rawPosts) {
    users.set(p.author.id, UpvotyUser.parse({ id: p.author.id, name: p.author.name }));
  }
  for (const c of rawComments) {
    if (!users.has(c.user_id)) {
      users.set(c.user_id, UpvotyUser.parse({ id: c.user_id, name: c.user_id }));
    }
  }
  for (const v of rawVotes) {
    if (!users.has(v.user_id)) {
      users.set(v.user_id, UpvotyUser.parse({ id: v.user_id, name: v.user_id }));
    }
  }

  return UpvotySnapshot.parse({ boards, users: Array.from(users.values()), posts });
}

interface RawPost {
  id: string;
  title: string;
  description?: string;
  status: string;
  board_id: string;
  author: { id: string; name: string };
  createdAt: string;
}

interface RawComment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  createdAt: string;
}

interface RawVote {
  id: string;
  post_id: string;
  user_id: string;
}
