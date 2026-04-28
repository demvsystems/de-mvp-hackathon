import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from './route';

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

async function writeFixture(source: string, filename: string) {
  const dir = path.resolve(outputAbsoluteDir, source);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath(source, filename), JSON.stringify({ ok: true }), 'utf8');
}

function filePath(source: string, filename: string): string {
  return path.resolve(outputAbsoluteDir, source, filename);
}

async function deleteFixture(body: unknown) {
  return DELETE(
    new Request('http://localhost:3001/api/fixture/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('DELETE /api/fixture/delete', () => {
  it('deletes existing file', async () => {
    await writeFixture('jira', '2026-04-28_jira_bug_login_001.json');
    const response = await deleteFixture({
      source: 'jira',
      filename: '2026-04-28_jira_bug_login_001.json',
    });

    expect(response.status).toBe(200);
    await expect(
      access(filePath('jira', '2026-04-28_jira_bug_login_001.json')),
    ).rejects.toBeDefined();
  });

  it('rejects traversal and non-json filename', async () => {
    const badBodies = [
      { source: 'slack', filename: '../x.json' },
      { source: 'slack', filename: 'x/y.json' },
      { source: 'slack', filename: 'x\\y.json' },
      { source: 'slack', filename: 'x.txt' },
      { source: 'slack', filename: 'x.jsonl' },
    ];

    for (const body of badBodies) {
      const response = await deleteFixture(body);
      expect(response.status).toBe(400);
    }
  });

  it('returns 404 for missing file', async () => {
    const response = await deleteFixture({
      source: 'upvoty',
      filename: '2026-04-28_upvoty_bug_missing_001.json',
    });
    expect(response.status).toBe(404);
  });
});
