import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

function resolvePlaygroundRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'playground' && path.basename(path.dirname(cwd)) === 'apps') {
    return cwd;
  }
  return path.resolve(cwd, 'apps', 'playground');
}

const PLAYGROUND_ROOT = resolvePlaygroundRoot();
const TMP_ROOT = path.resolve(PLAYGROUND_ROOT, '.tmp-saved-library-tests');

let runDirName = '';
let outputRelativeDir = '';
let outputAbsoluteDir = '';

beforeEach(async () => {
  runDirName = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  outputRelativeDir = `.tmp-saved-library-tests/${runDirName}`;
  outputAbsoluteDir = path.resolve(PLAYGROUND_ROOT, outputRelativeDir);
  await mkdir(outputAbsoluteDir, { recursive: true });
  process.env['PLAYGROUND_FIXTURE_OUTPUT_DIR'] = outputRelativeDir;
});

afterEach(async () => {
  await rm(path.resolve(TMP_ROOT, runDirName), { recursive: true, force: true });
  delete process.env['PLAYGROUND_FIXTURE_OUTPUT_DIR'];
});

async function writeFixture(source: string, filename: string, content: string) {
  const dir = path.resolve(outputAbsoluteDir, source);
  await mkdir(dir, { recursive: true });
  const filePath = path.resolve(dir, filename);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

async function list(query = '') {
  return GET(new Request(`http://localhost:3001/api/fixture/list${query}`, { method: 'GET' }));
}

describe('GET /api/fixture/list', () => {
  it('returns saved fixture metadata and supports source filter', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_login_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );
    await writeFixture(
      'jira',
      '2026-04-28_jira_bug_login_001.json',
      JSON.stringify({ issues: [] }),
    );

    const allResponse = await list();
    expect(allResponse.status).toBe(200);
    const allPayload = (await allResponse.json()) as {
      fixtures: Array<{ source: string; filename: string; validation?: { status: string } }>;
    };
    expect(allPayload.fixtures.length).toBe(2);
    expect(allPayload.fixtures.every((entry) => entry.validation !== undefined)).toBe(true);

    const filteredResponse = await list('?source=slack');
    expect(filteredResponse.status).toBe(200);
    const filteredPayload = (await filteredResponse.json()) as {
      fixtures: Array<{ source: string; filename: string }>;
    };
    expect(filteredPayload.fixtures).toHaveLength(1);
    expect(filteredPayload.fixtures[0]?.source).toBe('slack');
  });

  it('sorts by modifiedAt descending and filename ascending for ties', async () => {
    const fileA = await writeFixture(
      'intercom',
      '2026-04-28_intercom_bug_alpha_001.json',
      JSON.stringify({ event: { data: { item: { id: '1', message: '[DUMMY] alpha' } } } }),
    );
    const fileB = await writeFixture(
      'intercom',
      '2026-04-28_intercom_bug_beta_001.json',
      JSON.stringify({ event: { data: { item: { id: '2', message: '[DUMMY] beta' } } } }),
    );
    const fileC = await writeFixture(
      'intercom',
      '2026-04-28_intercom_bug_gamma_001.json',
      JSON.stringify({ event: { data: { item: { id: '3', message: '[DUMMY] gamma' } } } }),
    );

    const tieTime = new Date('2026-04-25T10:00:00.000Z');
    const newest = new Date('2026-04-28T10:00:00.000Z');
    await utimes(fileA, tieTime, tieTime);
    await utimes(fileB, tieTime, tieTime);
    await utimes(fileC, tieTime, tieTime);
    await utimes(fileB, newest, newest);

    const response = await list('?source=intercom');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      fixtures: Array<{ filename: string }>;
    };

    expect(payload.fixtures[0]?.filename).toBe('2026-04-28_intercom_bug_beta_001.json');
    expect(payload.fixtures[1]?.filename).toBe('2026-04-28_intercom_bug_alpha_001.json');
    expect(payload.fixtures[2]?.filename).toBe('2026-04-28_intercom_bug_gamma_001.json');
  });

  it('can include content and omit validation when requested', async () => {
    await writeFixture(
      'upvoty',
      '2026-04-28_upvoty_bug_search_001.json',
      JSON.stringify({ posts: [{ id: 'p1', title: '[DUMMY] Search fails' }] }),
    );

    const response = await list('?source=upvoty&includeContent=true&includeValidation=false');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      fixtures: Array<{ content?: unknown; validation?: unknown }>;
    };
    expect(payload.fixtures[0]?.content).toBeDefined();
    expect(payload.fixtures[0]?.validation).toBeUndefined();
  });

  it('includes invalid json file with validation error instead of crashing', async () => {
    await writeFixture('slack', '2026-04-28_slack_bug_invalid_001.json', '{broken');

    const response = await list('?source=slack');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      fixtures: Array<{ filename: string; validation?: { status: string } }>;
    };
    expect(payload.fixtures).toHaveLength(1);
    expect(payload.fixtures[0]?.filename).toBe('2026-04-28_slack_bug_invalid_001.json');
    expect(payload.fixtures[0]?.validation?.status).toBe('error');
  });
});
