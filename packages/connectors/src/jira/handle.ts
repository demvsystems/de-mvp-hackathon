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
  JiraSnapshot,
  type JiraBoard,
  type JiraIssue,
  type JiraProject,
  type JiraSprint,
} from './schema';
import { SOURCE, boardId, issueId, projectId, sprintId } from './ids';

const EDGE_SOURCE = edgeSource(SOURCE);

/** Normiert beliebige ISO-Datetime-Strings auf UTC mit `Z`-Suffix. */
function toUtc(input: string): IsoDateTime {
  return new Date(input).toISOString();
}

/**
 * Mappt einen Jira-Snapshot. Annahmen:
 * - Issue-/Project-IDs verwenden den Key. Im Pilot mit Mocks ohne
 *   Project-Moves ausreichend; in Produktion müssten wir die numerische
 *   `id` aus der Source-API verwenden.
 * - Issues haben im Mock keinen `created_at`; wir verwenden den Sprint-Start
 *   als plausiblen `occurred_at` (oder `now`, wenn Issue keinen Sprint hat).
 * - Datetime-Felder werden auf UTC normalisiert (`messaging` akzeptiert nur
 *   UTC-`Z`-Form, Mock liefert lokale Offsets wie `+02:00`).
 * - Edges, die zu einem Record gehören, tragen `causation_id` auf das
 *   dazugehörige Record-Event (siehe Z2).
 * - Comments werden vorerst nicht emittiert: der Mock liefert nur `authorRole`,
 *   keine User-ID — eine saubere `authored_by`-Edge ist damit nicht möglich.
 */
export function map(item: unknown): ConnectorOutput {
  const snap = JiraSnapshot.parse(item);
  const emissions: Emission[] = [];
  const now = new Date().toISOString();

  for (const p of snap.projects) {
    emissions.push(emitProject(p, now));
  }

  for (const b of snap.boards) {
    emitBoardCascade(b, now, emissions);
  }

  for (const s of snap.activeSprints) {
    emitSprintCascade(s, emissions);
  }

  const sprintsById = new Map(snap.activeSprints.map((s) => [s.id, s]));

  for (const issue of snap.issues) {
    const sprintStart = issue.sprintId ? sprintsById.get(issue.sprintId)?.startDate : undefined;
    const issueOccurredAt = sprintStart ? toUtc(sprintStart) : now;
    emitIssueCascade(issue, issueOccurredAt, emissions);
  }

  return { emissions };
}

function emitProject(p: JiraProject, occurredAt: IsoDateTime): Emission {
  const subjectId = projectId(p.key);
  return emit(RecordObserved, {
    source: SOURCE,
    occurred_at: occurredAt,
    subject_id: subjectId,
    source_event_id: p.key,
    payload: {
      id: subjectId,
      type: 'project',
      source: SOURCE,
      title: p.name,
      body: null,
      payload: {
        jira_id: p.id,
        key: p.key,
        name: p.name,
        type: p.type,
      },
      created_at: occurredAt,
      updated_at: occurredAt,
    },
  });
}

function emitBoardCascade(b: JiraBoard, occurredAt: IsoDateTime, emissions: Emission[]): void {
  const subjectId = boardId(b.id);
  const payload = {
    id: subjectId,
    type: 'board',
    source: SOURCE,
    title: b.name,
    body: null,
    payload: {
      board_id: b.id,
      name: b.name,
      type: b.type,
      project_key: b.projectKey,
    },
    created_at: occurredAt,
    updated_at: occurredAt,
  };

  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: subjectId,
    occurred_at: occurredAt,
    payload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: occurredAt,
      subject_id: subjectId,
      source_event_id: String(b.id),
      payload,
    }),
  );
  emissions.push(
    emitEdge('posted_in', subjectId, projectId(b.projectKey), occurredAt, causationId),
  );
}

function emitSprintCascade(s: JiraSprint, emissions: Emission[]): void {
  const subjectId = sprintId(s.id);
  const startUtc = toUtc(s.startDate);
  const endUtc = toUtc(s.endDate);
  const payload = {
    id: subjectId,
    type: 'sprint',
    source: SOURCE,
    title: s.name,
    body: s.goal ?? null,
    payload: {
      sprint_id: s.id,
      name: s.name,
      state: s.state,
      goal: s.goal ?? null,
      project_keys: s.projectKeys,
      board_id: s.boardId,
      start_date: startUtc,
      end_date: endUtc,
    },
    created_at: startUtc,
    updated_at: startUtc,
  };

  const causationId = predictRecordObservedId({
    source: SOURCE,
    subject_id: subjectId,
    occurred_at: startUtc,
    payload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: startUtc,
      subject_id: subjectId,
      source_event_id: String(s.id),
      payload,
    }),
  );
  for (const projectKey of s.projectKeys) {
    emissions.push(emitEdge('posted_in', subjectId, projectId(projectKey), startUtc, causationId));
  }
}

/** Felder einer Issue, die per `updates[].previous` rückwirkend rekonstruiert
 *  werden können. Andere Felder (key, projectKey, sprintId, type, attachments,
 *  comments) gelten als identitätsstiftend bzw. ändern sich im Pilot nicht. */
type IssueMutableState = Pick<
  JiraIssue,
  'status' | 'priority' | 'summary' | 'descriptionText' | 'labels' | 'components'
>;

function emitIssueCascade(issue: JiraIssue, occurredAt: IsoDateTime, emissions: Emission[]): void {
  const subjectId = issueId(issue.key);
  const updates = issue.updates ?? [];

  // Comments werden nicht als eigene Records emittiert (Mock liefert nur
  // authorRole, keine User-ID — keine saubere authored_by-Edge möglich). Damit
  // der Embedder den Diskussionskontext trotzdem sieht, werden Comment-Bodies
  // mit Rollen-Prefix an den Issue-Body angehängt.
  const commentsBody = issue.comments
    .map((c) => `[${c.authorRole}] ${c.bodyText}`)
    .filter(Boolean)
    .join('\n\n');

  const buildPayload = (
    state: IssueMutableState,
  ): {
    id: string;
    type: string;
    source: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    created_at: IsoDateTime;
    updated_at: IsoDateTime;
  } => ({
    id: subjectId,
    type: 'issue',
    source: SOURCE,
    title: state.summary,
    body: commentsBody ? `${state.descriptionText}\n\n${commentsBody}` : state.descriptionText,
    payload: {
      key: issue.key,
      project_key: issue.projectKey,
      sprint_id: issue.sprintId ?? null,
      issue_type: issue.type,
      status: state.status,
      priority: state.priority,
      labels: state.labels,
      components: state.components,
      attachment_count: issue.attachments.length,
      comment_count: issue.comments.length,
    },
    created_at: occurredAt,
    updated_at: occurredAt,
  });

  // Rollt die Updates ab Index `untilIdx+1` rückwärts auf den aktuellen Stand,
  // sodass `untilIdx === -1` den Original-Stand und `untilIdx === updates.length-1`
  // den Endstand liefert. Symmetrisch zur Slack-Edit-Kette.
  const stateAt = (untilIdx: number): IssueMutableState => {
    let state: IssueMutableState = {
      status: issue.status,
      priority: issue.priority,
      summary: issue.summary,
      descriptionText: issue.descriptionText,
      labels: issue.labels,
      components: issue.components,
    };
    for (let j = updates.length - 1; j > untilIdx; j--) {
      const prev = updates[j]!.previous;
      // Pro Feld einzeln zurückrollen: bei exactOptionalPropertyTypes lässt sich
      // Partial<>-Spread nicht typsicher auf Pflichtfelder anwenden.
      state = {
        status: prev.status ?? state.status,
        priority: prev.priority ?? state.priority,
        summary: prev.summary ?? state.summary,
        descriptionText: prev.descriptionText ?? state.descriptionText,
        labels: prev.labels ?? state.labels,
        components: prev.components ?? state.components,
      };
    }
    return state;
  };

  const observedPayload = buildPayload(stateAt(-1));
  const observedCausation = predictRecordObservedId({
    source: SOURCE,
    subject_id: subjectId,
    occurred_at: occurredAt,
    payload: observedPayload,
  });

  emissions.push(
    emit(RecordObserved, {
      source: SOURCE,
      occurred_at: occurredAt,
      subject_id: subjectId,
      source_event_id: issue.key,
      payload: observedPayload,
      correlation_id: subjectId,
    }),
  );
  emissions.push(
    emitIssueEdge(
      'posted_in',
      subjectId,
      projectId(issue.projectKey),
      occurredAt,
      observedCausation,
      subjectId,
    ),
  );
  if (issue.sprintId !== undefined) {
    emissions.push(
      emitIssueEdge(
        'belongs_to_sprint',
        subjectId,
        sprintId(issue.sprintId),
        occurredAt,
        observedCausation,
        subjectId,
      ),
    );
  }

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i]!;
    const newState = stateAt(i);
    emissions.push(
      emit(RecordUpdated, {
        source: SOURCE,
        occurred_at: update.at,
        subject_id: subjectId,
        source_event_id: `${issue.key}#update#${i}`,
        causation_id: observedCausation,
        correlation_id: subjectId,
        payload: {
          ...buildPayload(newState),
          updated_at: update.at,
        },
      }),
    );
  }

  if (issue.deleted_at !== undefined) {
    emissions.push(
      emit(RecordDeleted, {
        source: SOURCE,
        occurred_at: issue.deleted_at,
        subject_id: subjectId,
        source_event_id: `${issue.key}#delete`,
        causation_id: observedCausation,
        correlation_id: subjectId,
        payload: { id: subjectId },
      }),
    );
  }
}

/** Edge-Helper für Project/Board/Sprint — strukturelle Container ohne Konversations-
 *  kontext, daher correlation_id = null. */
function emitEdge(
  type: 'posted_in' | 'belongs_to_sprint',
  fromId: string,
  toId: string,
  validFrom: IsoDateTime,
  causationId: string,
): Emission {
  return emit(EdgeObserved, {
    source: SOURCE,
    occurred_at: validFrom,
    subject_id: makeEdgeId(type, fromId, toId),
    causation_id: causationId,
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

/** Edge-Helper für Issue-Cascade — trägt correlation_id auf das Issue-Subject. */
function emitIssueEdge(
  type: 'posted_in' | 'belongs_to_sprint',
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
