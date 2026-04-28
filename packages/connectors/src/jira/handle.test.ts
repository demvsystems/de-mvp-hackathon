import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission, type Emission } from '../core';
import { map } from './handle';
import { issueId } from './ids';

const MOCK = join(process.cwd(), '../../fixtures/jira.json');
const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

async function loadMock(): Promise<unknown> {
  return JSON.parse(await readFile(MOCK, 'utf8')) as unknown;
}

interface FixtureUpdate {
  at: string;
  previous: Record<string, unknown>;
}

interface FixtureIssue {
  key: string;
  status?: string;
  priority?: string;
  summary?: string;
  descriptionText?: string;
  labels?: string[];
  components?: string[];
  sprintId?: number;
  updates?: FixtureUpdate[];
  deleted_at?: string;
}

/**
 * Minimaler Jira-Snapshot: ein Project + ein Sprint + n Issues. Defaults sind
 * bewusst plausibel, damit Tests sich auf die zu prüfende Achse konzentrieren.
 */
function buildSnapshot(issues: FixtureIssue[]): unknown {
  return {
    source: { jiraSite: 'fixture.atlassian.net' },
    projects: [{ id: '10000', key: 'SHOP', name: 'Shop Platform', type: 'software' }],
    boards: [{ id: 1, name: 'SHOP Board', type: 'scrum', projectKey: 'SHOP' }],
    activeSprints: [
      {
        id: 100,
        name: 'Fixture Sprint',
        state: 'active',
        projectKeys: ['SHOP'],
        boardId: 1,
        startDate: '2026-04-20T09:00:00.000+02:00',
        endDate: '2026-05-03T18:00:00.000+02:00',
      },
    ],
    issues: issues.map((i) => ({
      key: i.key,
      projectKey: 'SHOP',
      sprintId: i.sprintId ?? 100,
      type: 'Bug',
      status: i.status ?? 'In Progress',
      priority: i.priority ?? 'High',
      summary: i.summary ?? 'fixture summary',
      descriptionText: i.descriptionText ?? 'fixture body',
      labels: i.labels ?? [],
      components: i.components ?? [],
      comments: [],
      attachments: [],
      ...(i.updates ? { updates: i.updates } : {}),
      ...(i.deleted_at ? { deleted_at: i.deleted_at } : {}),
    })),
  };
}

function findEmission(
  emissions: Emission[],
  predicate: (e: Emission) => boolean,
): Emission | undefined {
  return emissions.find(predicate);
}

describe('jira mapper', () => {
  it('mapt einen Snapshot auf Project/Board/Sprint/Issue und strukturelle Edges', async () => {
    const { emissions } = map(await loadMock());

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    // 2 projects (SHOP, BILLING) + 1 board + 1 sprint + 6 issues = 10
    expect(records).toHaveLength(10);

    expect(records.map((e) => e.subject_id).sort()).toEqual([
      'jira:board:84',
      'jira:issue:BILLING-77',
      'jira:issue:SHOP-142',
      'jira:issue:SHOP-201',
      'jira:issue:SHOP-205',
      'jira:issue:SHOP-220',
      'jira:issue:SHOP-240',
      'jira:project:BILLING',
      'jira:project:SHOP',
      'jira:sprint:123',
    ]);

    // board→project (1) + sprint→board (1) + issue→project (6) + issue→sprint (5,
    // BILLING-77 hat keinen Sprint) = 13
    expect(edges).toHaveLength(13);

    expect(
      edges.find((e) => e.subject_id.startsWith('edge:belongs_to_sprint:jira:issue:SHOP-142')),
    ).toBeDefined();
  });
});

describe('jira mapper — Vertrag', () => {
  it('alle Emissions validieren gegen ihre @repo/messaging-Schemas', async () => {
    const { emissions } = map(await loadMock());
    expect(() => assertContractValid(emissions)).not.toThrow();
  });

  it('alle Edge-Emissions tragen causation_id auf das Record-Event', async () => {
    const { emissions } = map(await loadMock());
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.causation_id, `${e.subject_id} fehlt causation_id`).not.toBeNull();
    }
  });
});

describe('jira mapper — Lifecycle', () => {
  it('ein Status-Update erzeugt observed (alter Status) plus updated (neuer Status)', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-200',
        status: 'In Progress',
        updates: [{ at: '2026-04-25T10:00:00.000Z', previous: { status: 'To Do' } }],
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-200');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;

    expect((observed.payload as { payload: { status: string } }).payload.status).toBe('To Do');
    expect((updated.payload as { payload: { status: string } }).payload.status).toBe('In Progress');
    expect((updated.payload as { updated_at: string }).updated_at).toBe('2026-04-25T10:00:00.000Z');
  });

  it('zwei Updates ergeben observed plus zwei record.updated in chronologischer Reihenfolge', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-201',
        status: 'Done',
        priority: 'High',
        updates: [
          { at: '2026-04-25T10:00:00.000Z', previous: { status: 'To Do' } },
          { at: '2026-04-26T10:00:00.000Z', previous: { status: 'In Progress' } },
        ],
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-201');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updates = emissions.filter(
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    );

    expect((observed.payload as { payload: { status: string } }).payload.status).toBe('To Do');
    expect(updates).toHaveLength(2);
    expect((updates[0]!.payload as { payload: { status: string } }).payload.status).toBe(
      'In Progress',
    );
    expect((updates[0]!.payload as { updated_at: string }).updated_at).toBe(
      '2026-04-25T10:00:00.000Z',
    );
    expect((updates[1]!.payload as { payload: { status: string } }).payload.status).toBe('Done');
    expect((updates[1]!.payload as { updated_at: string }).updated_at).toBe(
      '2026-04-26T10:00:00.000Z',
    );
  });

  it('updates auf mehreren Feldern werden korrekt rekonstruiert', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-202',
        status: 'Done',
        priority: 'Critical',
        labels: ['ready'],
        updates: [
          {
            at: '2026-04-26T11:00:00.000Z',
            previous: { status: 'In Progress', priority: 'High', labels: ['regression'] },
          },
        ],
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-202');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;

    const obsPayload = observed.payload as {
      payload: { status: string; priority: string; labels: string[] };
    };
    expect(obsPayload.payload.status).toBe('In Progress');
    expect(obsPayload.payload.priority).toBe('High');
    expect(obsPayload.payload.labels).toEqual(['regression']);

    const updPayload = updated.payload as {
      payload: { status: string; priority: string; labels: string[] };
    };
    expect(updPayload.payload.status).toBe('Done');
    expect(updPayload.payload.priority).toBe('Critical');
    expect(updPayload.payload.labels).toEqual(['ready']);
  });

  it('eine gelöschte Issue erzeugt observed plus record.deleted', () => {
    const snapshot = buildSnapshot([
      { key: 'SHOP-203', status: 'Done', deleted_at: '2026-04-27T12:00:00.000Z' },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-203');

    const deleted = findEmission(
      emissions,
      (e) => e.event_type === 'record.deleted' && e.subject_id === subjectId,
    );
    expect(deleted).toBeDefined();
    expect(deleted!.payload).toEqual({ id: subjectId });
  });

  it('updated und deleted tragen causation_id auf das initiale observed-Event', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-204',
        status: 'Done',
        updates: [{ at: '2026-04-26T10:00:00.000Z', previous: { status: 'In Progress' } }],
        deleted_at: '2026-04-27T10:00:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-204');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;
    const deleted = findEmission(
      emissions,
      (e) => e.event_type === 'record.deleted' && e.subject_id === subjectId,
    )!;

    expect(observed.causation_id).toBeNull();
    expect(updated.causation_id).not.toBeNull();
    expect(deleted.causation_id).not.toBeNull();
    expect(updated.causation_id).toBe(deleted.causation_id);
  });

  it('Lifecycle-Emissions validieren gegen die @repo/messaging-Schemas', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-205',
        status: 'Done',
        updates: [{ at: '2026-04-26T10:00:00.000Z', previous: { status: 'To Do' } }],
        deleted_at: '2026-04-27T10:00:00.000Z',
      },
    ]);
    const { emissions } = map(snapshot);
    expect(() => assertContractValid(emissions)).not.toThrow();
  });
});

describe('jira mapper — Korrelation', () => {
  it('Issue-Cascade (Record + Edges + Updates + Delete) korreliert auf das Issue-Subject', () => {
    const snapshot = buildSnapshot([
      {
        key: 'SHOP-300',
        status: 'Done',
        updates: [{ at: '2026-04-26T10:00:00.000Z', previous: { status: 'To Do' } }],
        deleted_at: '2026-04-27T10:00:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = issueId('SHOP-300');

    const issueEvents = emissions.filter(
      (e) =>
        e.subject_id === subjectId ||
        e.subject_id.startsWith(`edge:posted_in:${subjectId}->`) ||
        e.subject_id.startsWith(`edge:belongs_to_sprint:${subjectId}->`),
    );

    expect(issueEvents.length).toBeGreaterThan(0);
    for (const e of issueEvents) {
      expect(e.correlation_id, `${e.subject_id} fehlt correlation_id`).toBe(subjectId);
    }
  });

  it('Project, Board und Sprint korrelieren nicht (eigenständige strukturelle Container)', () => {
    const snapshot = buildSnapshot([{ key: 'SHOP-301' }]);
    const { emissions } = map(snapshot);

    const project = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === 'jira:project:SHOP',
    )!;
    const board = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === 'jira:board:1',
    )!;
    const sprint = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === 'jira:sprint:100',
    )!;

    expect(project.correlation_id).toBeNull();
    expect(board.correlation_id).toBeNull();
    expect(sprint.correlation_id).toBeNull();
  });
});

describe('jira mapper — Idempotenz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('zwei Aufrufe mit gleichem Input liefern identische Emissions', async () => {
    const input = await loadMock();
    const first = map(input).emissions.map(serializeEmission);
    const second = map(input).emissions.map(serializeEmission);
    expect(second).toEqual(first);
  });
});
