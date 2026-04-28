import { mkdir, rm, writeFile } from 'node:fs/promises';
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
}

async function readFixture(query: string) {
  return GET(new Request(`http://localhost:3001/api/fixture/read${query}`, { method: 'GET' }));
}

describe('GET /api/fixture/read', () => {
  it('returns content and validation for existing fixture', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_login_001.json',
      JSON.stringify({
        channel: { team_id: 'DE-MVP' },
        participants: [{ id: 'u1', team_id: 'DE-MVP' }],
        content: [{ id: 'm1', text: '[DUMMY] Login fails', author_id: 'u1', team_id: 'DE-MVP' }],
      }),
    );

    const response = await readFixture(
      '?source=slack&filename=2026-04-28_slack_bug_login_001.json',
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      filename: string;
      content: Record<string, unknown>;
      validation: { status: string };
    };
    expect(payload.filename).toBe('2026-04-28_slack_bug_login_001.json');
    expect(payload.content).toBeDefined();
    expect(payload.validation).toBeDefined();
  });

  it('rejects invalid source', async () => {
    const response = await readFixture('?source=foo&filename=x.json');
    expect(response.status).toBe(400);
  });

  it('rejects traversal and non-json filename', async () => {
    const badQueries = [
      '?source=jira&filename=../x.json',
      '?source=jira&filename=a/b.json',
      '?source=jira&filename=a\\\\b.json',
      '?source=jira&filename=x.txt',
      '?source=jira&filename=x.jsonl',
    ];
    for (const query of badQueries) {
      const response = await readFixture(query);
      expect(response.status).toBe(400);
    }
  });

  it('returns 404 for missing file', async () => {
    const response = await readFixture('?source=upvoty&filename=2026-04-28_upvoty_bug_x_001.json');
    expect(response.status).toBe(404);
  });

  it('returns parse error response with validation status error', async () => {
    await writeFixture('intercom', '2026-04-28_intercom_bug_x_001.json', '{invalid');

    const response = await readFixture(
      '?source=intercom&filename=2026-04-28_intercom_bug_x_001.json',
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      status: 'error';
      validation?: { status: string };
    };
    expect(payload.status).toBe('error');
    expect(payload.validation?.status).toBe('error');
  });
});
