import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixtureManifest } from './fixture-manifest';

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

describe('fixture-manifest', () => {
  it('builds manifest for empty fixture root', async () => {
    const manifest = await buildFixtureManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.summary.count).toBe(0);
    expect(manifest.summary.sizeBytes).toBe(0);
    expect(manifest.fixtures).toHaveLength(0);
    expect(Object.keys(manifest.sources)).toEqual(['jira', 'slack', 'upvoty', 'intercom']);
  });

  it('builds manifest across sources with correct summary and sorting', async () => {
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_b_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );
    await writeFixture(
      'slack',
      '2026-04-28_slack_bug_a_001.json',
      JSON.stringify({ channel: { team_id: 'DE-MVP' }, content: [] }),
    );
    await writeFixture(
      'jira',
      '2026-04-28_jira_bug_x_001.json',
      JSON.stringify({ issues: [{ key: 'JIRA-1', summary: '[DUMMY] Example' }] }),
    );

    const manifest = await buildFixtureManifest();
    expect(manifest.summary.count).toBe(3);
    expect(manifest.sources.jira.count).toBe(1);
    expect(manifest.sources.slack.count).toBe(2);
    expect(manifest.sources.upvoty.count).toBe(0);
    expect(manifest.sources.intercom.count).toBe(0);

    expect(manifest.fixtures.map((entry) => `${entry.source}:${entry.filename}`)).toEqual([
      'jira:2026-04-28_jira_bug_x_001.json',
      'slack:2026-04-28_slack_bug_a_001.json',
      'slack:2026-04-28_slack_bug_b_001.json',
    ]);

    const totalSize = manifest.fixtures.reduce((acc, entry) => acc + entry.sizeBytes, 0);
    expect(manifest.summary.sizeBytes).toBe(totalSize);
    expect('content' in manifest.fixtures[0]!).toBe(false);
  });

  it('source filter includes only requested source fixtures', async () => {
    await writeFixture(
      'intercom',
      '2026-04-28_intercom_bug_x_001.json',
      JSON.stringify({ ping: { data: { item: { id: '1', message: '[DUMMY] ping' } } } }),
    );
    await writeFixture('jira', '2026-04-28_jira_bug_x_001.json', JSON.stringify({ issues: [] }));

    const manifest = await buildFixtureManifest({ source: 'intercom' });
    expect(manifest.fixtures).toHaveLength(1);
    expect(manifest.fixtures[0]?.source).toBe('intercom');
    expect(manifest.summary.count).toBe(1);
    expect(manifest.sources.intercom.count).toBe(1);
    expect(manifest.sources.jira.count).toBe(0);
  });

  it('invalid JSON fixture is included with error validation status', async () => {
    await writeFixture('slack', '2026-04-28_slack_bug_invalid_001.json', '{bad-json');
    const manifest = await buildFixtureManifest();
    expect(manifest.fixtures).toHaveLength(1);
    expect(manifest.fixtures[0]?.validationStatus).toBe('error');
    expect(manifest.fixtures[0]?.issueCounts?.error).toBeGreaterThan(0);
    expect(manifest.summary.error).toBe(1);
  });

  it('includeValidation=false sets validation fields to null consistently', async () => {
    await writeFixture(
      'upvoty',
      '2026-04-28_upvoty_bug_x_001.json',
      JSON.stringify({ posts: [{ id: 'p1', title: '[DUMMY] One' }] }),
    );
    const manifest = await buildFixtureManifest({ includeValidation: false });
    expect(manifest.fixtures[0]?.validationStatus).toBeNull();
    expect(manifest.fixtures[0]?.issueCounts).toBeNull();
    expect(manifest.summary.valid).toBe(0);
    expect(manifest.summary.warning).toBe(0);
    expect(manifest.summary.error).toBe(0);
  });
});
