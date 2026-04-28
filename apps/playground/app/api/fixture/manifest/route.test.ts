import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const TMP_ROOT = path.resolve(PLAYGROUND_ROOT, '.tmp-manifest-tests');

let runDirName = '';
let outputRelativeDir = '';
let outputAbsoluteDir = '';

beforeEach(async () => {
  runDirName = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  outputRelativeDir = `.tmp-manifest-tests/${runDirName}`;
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
  await writeFile(path.resolve(dir, filename), content, 'utf8');
}

async function getManifest(query = '') {
  return GET(new Request(`http://localhost:3001/api/fixture/manifest${query}`, { method: 'GET' }));
}

describe('GET /api/fixture/manifest', () => {
  it('returns manifest', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_x_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );
    const response = await getManifest();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { summary: { count: number } };
    expect(payload.summary.count).toBe(1);
  });

  it('filters by source', async () => {
    await writeFixture('jira', '2026-04-28_jira_bug_x_001.json', JSON.stringify({ issues: [] }));
    await writeFixture('slack', '2026-04-28_slack_bug_x_001.json', JSON.stringify({ content: [] }));
    const response = await getManifest('?source=slack');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      fixtures: Array<{ source: string }>;
      summary: { count: number };
    };
    expect(payload.fixtures).toHaveLength(1);
    expect(payload.fixtures[0]?.source).toBe('slack');
    expect(payload.summary.count).toBe(1);
  });

  it('writes manifest.json when write=true', async () => {
    await writeFixture('upvoty', '2026-04-28_upvoty_bug_x_001.json', JSON.stringify({ posts: [] }));
    const response = await getManifest('?write=true');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      written: { filename: string; path: string };
      manifest: { summary: { count: number } };
    };
    expect(payload.written.filename).toBe('manifest.json');
    expect(payload.written.path.endsWith('/manifest.json')).toBe(true);
    expect(payload.manifest.summary.count).toBe(1);

    const raw = await readFile(path.resolve(outputAbsoluteDir, 'manifest.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw) as unknown).toBeTruthy();
  });

  it('writes manifest.{source}.json when source and write=true', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_x_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );
    const response = await getManifest('?source=slack&write=true');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      written: { filename: string; path: string };
      manifest: { fixtures: Array<{ source: string }> };
    };
    expect(payload.written.filename).toBe('manifest.slack.json');
    expect(payload.written.path.endsWith('/manifest.slack.json')).toBe(true);
    expect(payload.manifest.fixtures.every((entry) => entry.source === 'slack')).toBe(true);
  });

  it('rejects invalid source', async () => {
    const response = await getManifest('?source=invalid');
    expect(response.status).toBe(400);
  });
});
