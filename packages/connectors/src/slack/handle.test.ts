import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission } from '../core';
import { map } from './handle';

const MOCK = join(process.cwd(), '../../apps/playground/Dummyfiles/slack.json');
const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

async function loadMock(): Promise<unknown> {
  return JSON.parse(await readFile(MOCK, 'utf8')) as unknown;
}

describe('slack mapper', () => {
  it('mapt einen Channel-Snapshot auf erwartete Records und Edges', async () => {
    const { emissions } = map(await loadMock());

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    // 1 Channel + 4 Teilnehmer + 6 Messages (3 Top-Level + 3 Thread-Replies)
    expect(records).toHaveLength(11);

    // Pro Message: posted_in + authored_by = 12, plus 3 replies_to.
    // mentions-Edges werden vom Connector nicht emittiert (Z7 / Mention-Extractor).
    expect(edges).toHaveLength(15);

    expect(
      records.find((e) => e.subject_id.endsWith(':channel:hackathon/C111PRODUCT1')),
    ).toBeDefined();
    expect(edges.filter((e) => e.subject_id.includes(':replies_to:'))).toHaveLength(3);
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
