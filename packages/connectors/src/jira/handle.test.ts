import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertContractValid, serializeEmission } from '../core';
import { map } from './handle';

const MOCK = join(process.cwd(), '../../apps/playground/Dummyfiles/jira.json');
const FROZEN_NOW = '2026-04-28T09:00:00.000Z';

async function loadMock(): Promise<unknown> {
  return JSON.parse(await readFile(MOCK, 'utf8')) as unknown;
}

describe('jira mapper', () => {
  it('mapt einen Snapshot auf Project/Board/Sprint/Issue und strukturelle Edges', async () => {
    const { emissions } = map(await loadMock());

    const records = emissions.filter((e) => e.event_type === 'record.observed');
    const edges = emissions.filter((e) => e.event_type === 'edge.observed');

    expect(records).toHaveLength(4);
    expect(edges).toHaveLength(4);

    expect(records.map((e) => e.subject_id).sort()).toEqual([
      'jira:board:84',
      'jira:issue:SHOP-142',
      'jira:project:SHOP',
      'jira:sprint:123',
    ]);

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
