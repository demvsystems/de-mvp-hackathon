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
  type UpvotyUserRole,
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
      body: b.description ?? null,
      payload: {
        upvoty_id: b.id,
        name: b.name,
        slug: b.slug ?? null,
        privacy: b.privacy ?? null,
        description: b.description ?? null,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

/**
 * Internal-/External-Flags aus der Upvoty-Rolle ableiten. `admin` und `team`
 * sind Mitarbeiter (interne Stimmen, sollten in Topic-Discovery anders
 * gewichtet werden), `customer` und unbekannt sind extern. Anonyme Voter, die
 * gar nicht in `users[]` auftauchen, sehen wir hier nicht — die werden im
 * Post-`voter_ids` als Token-IDs sichtbar, falls Upvoty sie liefert.
 */
function classifyUser(role: UpvotyUserRole | undefined): {
  is_internal: boolean;
  is_external: boolean;
} {
  if (role === 'admin' || role === 'team') {
    return { is_internal: true, is_external: false };
  }
  return { is_internal: false, is_external: true };
}

function emitUser(u: UpvotyUser, occurredAt: IsoDateTime): Emission {
  const subjectId = userId(u.id);
  const { is_internal, is_external } = classifyUser(u.role);
  // created_at vom User ist im Mock optional; wenn vorhanden, ist es das
  // ehrlichere Signal als der Snapshot-Lesezeitpunkt.
  const userOccurredAt = u.created_at ?? occurredAt;
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: userOccurredAt,
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
        avatar_url: u.avatar_url ?? null,
        role: u.role ?? null,
        verified: u.verified ?? null,
        sso_provider: u.sso_provider ?? null,
        sso_user_id: u.sso_user_id ?? null,
        segments: u.segments ?? [],
        custom_fields: u.custom_fields ?? {},
        is_internal,
        is_external,
      },
      created_at: userOccurredAt,
      updated_at: userOccurredAt,
    },
  });
}

/** Mutable Felder eines Posts, die per `updates[].previous` rekonstruierbar sind. */
interface PostStateSlice {
  status: string;
  title: string;
  body: string | null;
  category: string | null;
  tags: string[];
  pinned: boolean;
  merged_into_id: string | null;
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
  // Internal-Comments (Team-Notizen) werden bewusst NICHT in den Anker-Body
  // eingewoben: sie sind in der Upvoty-UI für Customer unsichtbar und sollten
  // auch im Embedding-Kontext nicht den Topic-Diskurs verschieben. Sie bleiben
  // aber als eigene Records emittiert (mit `is_internal: true` im Payload).
  const commentsBody = p.comments
    .filter((c) => !c.is_internal)
    .map((c) => c.body)
    .filter(Boolean)
    .join('\n\n');

  const stateAt = (untilIdx: number): PostStateSlice => {
    let state: PostStateSlice = {
      status: p.status,
      title: p.title,
      body: p.body,
      category: p.category ?? null,
      tags: p.tags,
      pinned: p.pinned ?? false,
      merged_into_id: p.merged_into_id ?? null,
    };
    for (let j = updates.length - 1; j > untilIdx; j--) {
      const prev = updates[j]!.previous;
      // body/category/merged_into_id können explizit null sein (war vorher
      // leer/nicht gemerged). Daher `!== undefined` statt `??`.
      state = {
        status: prev.status ?? state.status,
        title: prev.title ?? state.title,
        body: prev.body !== undefined ? prev.body : state.body,
        category: prev.category !== undefined ? prev.category : state.category,
        tags: prev.tags ?? state.tags,
        pinned: prev.pinned ?? state.pinned,
        merged_into_id:
          prev.merged_into_id !== undefined ? prev.merged_into_id : state.merged_into_id,
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
      slug: p.slug ?? null,
      status: s.status,
      category: s.category,
      tags: s.tags,
      pinned: s.pinned,
      merged_into_id: s.merged_into_id,
      estimated_launch_date: p.estimated_launch_date ?? null,
      board_id: p.board_id,
      author_id: p.author_id,
      vote_count: p.vote_count,
      voter_count: p.voter_ids.length,
      // Voter-IDs selbst durchreichen, damit Down-Stream-Worker (Power-Voter,
      // Topic-Discovery, Heavy-User-Erkennung) damit arbeiten können. Edge-
      // Vokabular hat heute kein `voted_by` — sobald Z1 das ergänzt, kann ein
      // späterer Schritt die Edges additiv aus diesem Feld emittieren.
      voter_ids: p.voter_ids,
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
      // Nested-Reply-Info bleibt vorerst nur im Payload — Edge-Vokabular hat
      // kein `replies_to` für Upvoty-Comments. Reicht aus, um Threads in der
      // UI zu rekonstruieren.
      parent_comment_id: c.parent_id ?? null,
      is_internal: c.is_internal ?? false,
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
