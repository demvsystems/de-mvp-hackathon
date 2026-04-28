import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission, type Emission } from '../core';
import { map } from './handle';
import { channelId, messageId } from './ids';

const MOCK = join(process.cwd(), '../../fixtures/slack.json');
const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

async function loadMock(): Promise<unknown> {
  return JSON.parse(await readFile(MOCK, 'utf8')) as unknown;
}

interface FixtureMessage {
  id: string;
  slack_ts: string;
  datetime: string;
  text: string;
  author?: string;
  edits?: Array<{ edited_at: string; previous_text: string }>;
  deleted_at?: string;
  thread?: FixtureMessage[];
}

/**
 * Baut ein minimales Slack-Snapshot mit einem Channel und einem Teilnehmer.
 * Nachrichten lassen sich als kompakte FixtureMessage übergeben — der Helper
 * füllt die Slack-Schema-Pflichtfelder mit Defaults auf.
 */
function buildSnapshot(messages: FixtureMessage[]): unknown {
  const renderMessage = (m: FixtureMessage, isReply: boolean): unknown => ({
    type: isReply ? 'thread_reply' : 'chat_message',
    id: m.id,
    slack_ts: m.slack_ts,
    datetime: m.datetime,
    author: { id: m.author ?? 'U001', display_name: 'Anna Keller' },
    text: m.text,
    mentions: [],
    reactions: [],
    ...(m.edits ? { edits: m.edits } : {}),
    ...(m.deleted_at ? { deleted_at: m.deleted_at } : {}),
    ...(m.thread
      ? {
          thread: {
            id: `thread_${m.id}`,
            root_message_id: m.id,
            reply_count: m.thread.length,
            messages: m.thread.map((r) => renderMessage(r, true)),
          },
        }
      : {}),
  });

  return {
    channel: {
      id: 'C111',
      name: 'fixture',
      display_name: '#fixture',
      type: 'public_channel',
    },
    participants: [{ id: 'U001', display_name: 'Anna Keller', real_name: 'Anna Keller' }],
    content: messages.map((m) => renderMessage(m, false)),
  };
}

const CHANNEL_SUBJECT = channelId('C111');
const messageSubject = (slackTs: string): string => messageId('C111', slackTs);

function findEmission(
  emissions: Emission[],
  predicate: (e: Emission) => boolean,
): Emission | undefined {
  return emissions.find(predicate);
}

describe('slack mapper', () => {
  it('mapt einen Channel-Snapshot auf erwartete Records und Edges', async () => {
    const { emissions } = map(await loadMock());

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    // 1 Channel + 4 Teilnehmer + 10 Messages (6 Top-Level + 4 Thread-Replies)
    expect(records).toHaveLength(15);

    // Pro Message: posted_in + authored_by = 20, plus 4 replies_to.
    // mentions-Edges werden vom Connector nicht emittiert (Z7 / Mention-Extractor).
    expect(edges).toHaveLength(24);

    expect(
      records.find((e) => e.subject_id.endsWith(':channel:hackathon/C111PRODUCT1')),
    ).toBeDefined();
    expect(edges.filter((e) => e.subject_id.includes(':replies_to:'))).toHaveLength(4);
    expect(edges.filter((e) => e.subject_id.includes(':mentions:'))).toHaveLength(0);
  });

  it('verwendet einen deterministischen Workspace-Default', async () => {
    const { emissions } = map(await loadMock());
    const userRecords = emissions.filter(
      (e) => e.event_type === 'record.observed' && e.subject_id.includes(':user:hackathon/'),
    );
    expect(userRecords).toHaveLength(4);
  });
});

describe('slack mapper — Vertrag', () => {
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

describe('slack mapper — Lifecycle', () => {
  it('eine editierte Nachricht erzeugt observed (alter Text) plus updated (neuer Text)', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_edit',
        slack_ts: '1777370000.000100',
        datetime: '2026-04-28T10:00:00.000Z',
        text: 'korrigierter text',
        edits: [{ edited_at: '2026-04-28T10:05:00.000Z', previous_text: 'original text' }],
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = messageSubject('1777370000.000100');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    );
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    );

    expect(observed).toBeDefined();
    expect(updated).toBeDefined();
    expect((observed!.payload as { body: string }).body).toBe('original text');
    expect((updated!.payload as { body: string }).body).toBe('korrigierter text');
    expect((updated!.payload as { updated_at: string }).updated_at).toBe(
      '2026-04-28T10:05:00.000Z',
    );
  });

  it('mehrere Edits werden chronologisch als kette von updated emittiert', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_multi_edit',
        slack_ts: '1777371000.000100',
        datetime: '2026-04-28T10:10:00.000Z',
        text: 'finale fassung',
        edits: [
          { edited_at: '2026-04-28T10:11:00.000Z', previous_text: 'erste fassung' },
          { edited_at: '2026-04-28T10:12:00.000Z', previous_text: 'zweite fassung' },
        ],
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = messageSubject('1777371000.000100');
    const updates = emissions.filter(
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    );

    expect(updates).toHaveLength(2);
    expect((updates[0]!.payload as { body: string }).body).toBe('zweite fassung');
    expect((updates[0]!.payload as { updated_at: string }).updated_at).toBe(
      '2026-04-28T10:11:00.000Z',
    );
    expect((updates[1]!.payload as { body: string }).body).toBe('finale fassung');
    expect((updates[1]!.payload as { updated_at: string }).updated_at).toBe(
      '2026-04-28T10:12:00.000Z',
    );
  });

  it('eine gelöschte Nachricht erzeugt observed plus tombstoned', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_del',
        slack_ts: '1777372000.000100',
        datetime: '2026-04-28T10:20:00.000Z',
        text: 'wird gleich gelöscht',
        deleted_at: '2026-04-28T10:25:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = messageSubject('1777372000.000100');

    const tombstone = findEmission(
      emissions,
      (e) => e.event_type === 'record.tombstoned' && e.subject_id === subjectId,
    );
    expect(tombstone).toBeDefined();
    expect(tombstone!.payload).toEqual({ id: subjectId });
  });

  it('updated/tombstoned tragen causation_id auf das initiale observed-Event', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_caus',
        slack_ts: '1777373000.000100',
        datetime: '2026-04-28T10:30:00.000Z',
        text: 'final',
        edits: [{ edited_at: '2026-04-28T10:31:00.000Z', previous_text: 'initial' }],
        deleted_at: '2026-04-28T10:32:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = messageSubject('1777373000.000100');

    const observed = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === subjectId,
    )!;
    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;
    const tombstone = findEmission(
      emissions,
      (e) => e.event_type === 'record.tombstoned' && e.subject_id === subjectId,
    )!;

    // observed selbst hat kein causation_id (es ist die Wurzel der Cascade).
    expect(observed.causation_id).toBeNull();
    // updated/tombstoned zeigen auf observed — ohne dass observed schon publiziert ist.
    expect(updated.causation_id).not.toBeNull();
    expect(tombstone.causation_id).not.toBeNull();
    expect(updated.causation_id).toBe(tombstone.causation_id);
  });

  it('Lifecycle-Emissions validieren gegen die @repo/messaging-Schemas', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_contract',
        slack_ts: '1777374000.000100',
        datetime: '2026-04-28T10:40:00.000Z',
        text: 'aktuell',
        edits: [{ edited_at: '2026-04-28T10:41:00.000Z', previous_text: 'vorher' }],
        deleted_at: '2026-04-28T10:42:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    expect(() => assertContractValid(emissions)).not.toThrow();
  });
});

describe('slack mapper — Korrelation', () => {
  it('alle Messages und Edges eines Threads teilen sich die correlation_id der Top-Level-Message', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_top',
        slack_ts: '1777380000.000100',
        datetime: '2026-04-28T11:00:00.000Z',
        text: 'Frage in den Raum',
        thread: [
          {
            id: 'msg_top_r1',
            slack_ts: '1777380060.000100',
            datetime: '2026-04-28T11:01:00.000Z',
            text: 'Antwort eins',
          },
          {
            id: 'msg_top_r2',
            slack_ts: '1777380120.000100',
            datetime: '2026-04-28T11:02:00.000Z',
            text: 'Antwort zwei',
          },
        ],
      },
    ]);

    const { emissions } = map(snapshot);
    const topSubject = messageSubject('1777380000.000100');
    const reply1 = messageSubject('1777380060.000100');
    const reply2 = messageSubject('1777380120.000100');

    const messageEmissions = emissions.filter(
      (e) =>
        (e.event_type === 'record.observed' &&
          [topSubject, reply1, reply2].includes(e.subject_id)) ||
        e.event_type === 'edge.observed',
    );

    expect(messageEmissions.length).toBeGreaterThan(0);
    for (const e of messageEmissions) {
      expect(e.correlation_id, `${e.subject_id} fehlt correlation_id`).toBe(topSubject);
    }
  });

  it('Channel- und User-Records korrelieren NICHT auf eine Thread-ID (kein Thread-Kontext)', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_solo',
        slack_ts: '1777381000.000100',
        datetime: '2026-04-28T11:10:00.000Z',
        text: 'alleinstehend',
      },
    ]);

    const { emissions } = map(snapshot);

    const channelObs = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === CHANNEL_SUBJECT,
    )!;
    const userObs = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id.includes(':user:'),
    )!;

    expect(channelObs.correlation_id).toBeNull();
    expect(userObs.correlation_id).toBeNull();
  });

  it('Standalone-Top-Level-Message korreliert auf sich selbst', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_solo2',
        slack_ts: '1777382000.000100',
        datetime: '2026-04-28T11:20:00.000Z',
        text: 'einzeln',
      },
    ]);

    const { emissions } = map(snapshot);
    const soloSubject = messageSubject('1777382000.000100');

    const msgObs = findEmission(
      emissions,
      (e) => e.event_type === 'record.observed' && e.subject_id === soloSubject,
    )!;
    expect(msgObs.correlation_id).toBe(soloSubject);

    const authoredEdge = findEmission(
      emissions,
      (e) => e.event_type === 'edge.observed' && e.subject_id.includes(':authored_by:'),
    )!;
    expect(authoredEdge.correlation_id).toBe(soloSubject);
  });

  it('updated und tombstoned tragen die correlation_id der Top-Level-Message', () => {
    const snapshot = buildSnapshot([
      {
        id: 'msg_corr_lc',
        slack_ts: '1777383000.000100',
        datetime: '2026-04-28T11:30:00.000Z',
        text: 'aktuell',
        edits: [{ edited_at: '2026-04-28T11:31:00.000Z', previous_text: 'vorher' }],
        deleted_at: '2026-04-28T11:32:00.000Z',
      },
    ]);

    const { emissions } = map(snapshot);
    const subjectId = messageSubject('1777383000.000100');

    const updated = findEmission(
      emissions,
      (e) => e.event_type === 'record.updated' && e.subject_id === subjectId,
    )!;
    const tombstone = findEmission(
      emissions,
      (e) => e.event_type === 'record.tombstoned' && e.subject_id === subjectId,
    )!;

    expect(updated.correlation_id).toBe(subjectId);
    expect(tombstone.correlation_id).toBe(subjectId);
  });
});

describe('slack mapper — Idempotenz', () => {
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
