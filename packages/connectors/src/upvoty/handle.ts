import { EdgeObserved, RecordDeleted, RecordObserved, RecordUpdated } from '@repo/messaging';
import {
  edgeSource,
  emit,
  makeEdgeId,
  predictRecordObservedId,
  type ConnectorOutput,
  type Emission,
  type IsoDateTime,
} from '../core';
import {
  UpvotySnapshot,
  type UpvotyBoard,
  type UpvotyComment,
  type UpvotyPost,
  type UpvotyUser,
} from './schema';
import { SOURCE, boardId, commentId, postId, userId } from './ids';

const EDGE_SOURCE = edgeSource(SOURCE);

/**
 * Skelett-Mapper für Upvoty (Feature-Voting). Annahmen:
 * - Posts haben einen Author und gehören zu einem Board.
 * - Comments haben einen Author und sind über `commented_on` an den Post gehängt.
 * - Edges einer Post/Comment-Cascade tragen `causation_id` auf das jeweilige
 *   Record-Event.
 * - Voter werden als User-Records emittiert, aber Vote-Edges erstmal nicht —
 *   das Edge-Vokabular aus Z1 hat kein `voted_by`. TODO: mit Datenmodell-Owner
 *   klären, ob `voted_by` ergänzt werden soll oder eine Mention-/References-
 *   Edge ausreicht.
 */
export function map(item: unknown): ConnectorOutput {
  const snap = UpvotySnapshot.parse(item);
  const emissions: Emission[] = [];
  const now = new Date().toISOString();

  for (const b of snap.boards) {
    emissions.push(emitBoard(b, now));
  }
  for (const u of snap.users) {
    emissions.push(emitUser(u, now));
  }
  for (const p of snap.posts) {
    emitPostCascade(p, emissions);
  }

  return { emissions };
}

function emitBoard(b: UpvotyBoard, occurredAt: IsoDateTime): Emission {
  const subjectId = boardId(b.id);
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: b.id,
    payload: {
      id: subjectId,
      type: 'board',
      source: SOURCE,
      title: b.name,
      body: null,
      payload: {
        upvoty_id: b.id,
        name: b.name,
        slug: b.slug ?? null,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function emitUser(u: UpvotyUser, occurredAt: IsoDateTime): Emission {
  const subjectId = userId(u.id);
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: u.id,
    payload: {
      id: subjectId,
      type: 'user',
      source: SOURCE,
      title: u.name,
      body: null,
      payload: {
        upvoty_id: u.id,
        name: u.name,
        email: u.email ?? null,
        is_external: true,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

/** Mutable Felder eines Posts, die per `updates[].previous` rekonstruierbar sind. */
interface PostStateSlice {
  status: string;
  title: string;
  body: string | null;
}

function emitPostCascade(p: UpvotyPost, emissions: Emission[]): void {
  const postSubjectId = postId(p.id);
  const authorSubjectId = userId(p.author_id);
  const boardSubjectId = boardId(p.board_id);
  const updates = p.updates ?? [];

  // Comments werden zusätzlich als eigene Records emittiert (siehe
  // emitCommentCascade unten). Für den Post als Cluster-Anker werden die
  // Comment-Bodies aber zusätzlich an den Post-Body angehängt — analog zur
  // Slack-Thread- bzw. Intercom-Parts-Anreicherung.
  const commentsBody = p.comments
    .map((c) => c.body)
    .filter(Boolean)
    .join('\n\n');

  const stateAt = (untilIdx: number): PostStateSlice => {
    let state: PostStateSlice = { status: p.status, title: p.title, body: p.body };
    for (let j = updates.length - 1; j > untilIdx; j--) {
      const prev = updates[j]!.previous;
      // body kann explizit null sein (war vorher leer). Daher `!== undefined`.
      state = {
        status: prev.status ?? state.status,
        title: prev.title ?? state.title,
        body: prev.body !== undefined ? prev.body : state.body,
      };
    }
    return state;
  };

  const buildPayload = (
    s: PostStateSlice,
    updatedAt: string,
  ): {
    id: string;
    type: string;
    source: string;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  } => ({
    id: postSubjectId,
    type: 'post',
    source: SOURCE,
    title: s.title,
    body:
      commentsBody && s.body ? `${s.body}\n\n${commentsBody}` : (s.body ?? (commentsBody || null)),
    payload: {
      upvoty_id: p.id,
      status: s.status,
      board_id: p.board_id,
      author_id: p.author_id,
      vote_count: p.vote_count,
      voter_count: p.voter_ids.length,
      comment_count: p.comments.length,
    },
    created_at: p.created_at,
    updated_at: updatedAt,
  });

  const observedPayload = buildPayload(stateAt(-1), p.created_at);
  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: postSubjectId,
    occurred_at: p.created_at,
    payload: observedPayload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: p.created_at,
      subject_id: postSubjectId,
      source_event_id: p.id,
      payload: observedPayload,
      correlation_id: postSubjectId,
    }),
  );

  emissions.push(
    emitPostEdge(
      'authored_by',
      postSubjectId,
      authorSubjectId,
      p.created_at,
      causationId,
      postSubjectId,
    ),
  );
  emissions.push(
    emitPostEdge(
      'posted_in',
      postSubjectId,
      boardSubjectId,
      p.created_at,
      causationId,
      postSubjectId,
    ),
  );

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i]!;
    emissions.push(
      emit(RecordUpdated, {
        source: SOURCE,
        occurred_at: update.at,
        subject_id: postSubjectId,
        source_event_id: `${p.id}#update#${i}`,
        causation_id: causationId,
        correlation_id: postSubjectId,
        payload: buildPayload(stateAt(i), update.at),
      }),
    );
  }

  if (p.deleted_at !== undefined) {
    emissions.push(
      emit(RecordDeleted, {
        source: SOURCE,
        occurred_at: p.deleted_at,
        subject_id: postSubjectId,
        source_event_id: `${p.id}#delete`,
        causation_id: causationId,
        correlation_id: postSubjectId,
        payload: { id: postSubjectId },
      }),
    );
  }

  for (const c of p.comments) {
    emitCommentCascade(c, p.id, postSubjectId, emissions);
  }
}

function emitCommentCascade(
  c: UpvotyComment,
  postRawId: string,
  postSubjectId: string,
  emissions: Emission[],
): void {
  const commentSubjectId = commentId(postRawId, c.id);
  const authorSubjectId = userId(c.author_id);
  const payload = {
    id: commentSubjectId,
    type: 'comment',
    source: SOURCE,
    title: null,
    body: c.body,
    payload: {
      upvoty_id: c.id,
      post_id: postRawId,
      author_id: c.author_id,
    },
    created_at: c.created_at,
    updated_at: c.created_at,
  };

  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: commentSubjectId,
    occurred_at: c.created_at,
    payload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: c.created_at,
      subject_id: commentSubjectId,
      source_event_id: c.id,
      payload,
      correlation_id: postSubjectId,
    }),
  );

  emissions.push(
    emitPostEdge(
      'commented_on',
      commentSubjectId,
      postSubjectId,
      c.created_at,
      causationId,
      postSubjectId,
    ),
  );
  emissions.push(
    emitPostEdge(
      'authored_by',
      commentSubjectId,
      authorSubjectId,
      c.created_at,
      causationId,
      postSubjectId,
    ),
  );
}

/** Edge-Helper für die Post-Cascade — trägt correlation_id auf das Post-Subject. */
function emitPostEdge(
  type: 'posted_in' | 'authored_by' | 'commented_on',
  fromId: string,
  toId: string,
  validFrom: IsoDateTime,
  causationId: string,
  correlationId: string,
): Emission {
  return emit(EdgeObserved, {
    source: SOURCE,
    occurred_at: validFrom,
    subject_id: makeEdgeId(type, fromId, toId),
    causation_id: causationId,
    correlation_id: correlationId,
    payload: {
      from_id: fromId,
      to_id: toId,
      type,
      source: EDGE_SOURCE,
      confidence: 1.0,
      weight: 1.0,
      valid_from: validFrom,
      valid_to: null,
    },
  });
}
