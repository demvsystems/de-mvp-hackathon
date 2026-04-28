import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteSavedFixture,
  listSavedFixtures,
  readSavedFixture,
  SavedFixtureError,
} from './saved-fixtures';

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
  await writeFile(path.resolve(dir, filename), content, 'utf8');
}

describe('saved-fixtures module', () => {
  it('lists fixtures and can include content + validation', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_login_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );

    const listed = await listSavedFixtures({
      source: 'slack',
      includeContent: true,
      includeValidation: true,
    });

    expect(listed.fixtures).toHaveLength(1);
    expect(listed.fixtures[0]?.content).toBeDefined();
    expect(listed.fixtures[0]?.validation).toBeDefined();
  });

  it('reads and deletes a saved fixture', async () => {
    await writeFixture(
      'jira',
      '2026-04-28_jira_bug_login_001.json',
      JSON.stringify({ issues: [{ key: 'JIRA-1', summary: '[DUMMY] Login broken' }] }),
    );

    const read = await readSavedFixture({
      source: 'jira',
      filename: '2026-04-28_jira_bug_login_001.json',
    });
    expect(read.content).toBeDefined();
    expect(read.validation).toBeDefined();

    const removed = await deleteSavedFixture({
      source: 'jira',
      filename: '2026-04-28_jira_bug_login_001.json',
    });
    expect(removed.deleted).toBe(true);

    await expect(
      readSavedFixture({
        source: 'jira',
        filename: '2026-04-28_jira_bug_login_001.json',
      }),
    ).rejects.toBeInstanceOf(SavedFixtureError);
  });
});
