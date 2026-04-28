import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

function resolvePlaygroundRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'playground' && path.basename(path.dirname(cwd)) === 'apps') {
    return cwd;
  }
  return path.resolve(cwd, 'apps', 'playground');
}

const PLAYGROUND_ROOT = resolvePlaygroundRoot();
const TMP_ROOT = path.resolve(PLAYGROUND_ROOT, '.tmp-save-tests');

let runDirName = '';
let outputRelativeDir = '';
let outputAbsoluteDir = '';

beforeEach(async () => {
  runDirName = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  outputRelativeDir = `.tmp-save-tests/${runDirName}`;
  outputAbsoluteDir = path.resolve(PLAYGROUND_ROOT, outputRelativeDir);
  await mkdir(outputAbsoluteDir, { recursive: true });
  process.env['PLAYGROUND_FIXTURE_OUTPUT_DIR'] = outputRelativeDir;
});

afterEach(async () => {
  await rm(path.resolve(TMP_ROOT, runDirName), { recursive: true, force: true });
  delete process.env['PLAYGROUND_FIXTURE_OUTPUT_DIR'];
});

async function postSave(body: unknown) {
  return POST(
    new Request('http://localhost:3001/api/fixture/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/fixture/save', () => {
  it('valid save writes json files, pretty-printed, trailing newline', async () => {
    const response = await postSave({
      source: 'slack',
      items: [
        {
          filename: '2026-04-28_slack_bug_login_001.json',
          content: { a: 1, nested: { b: true } },
        },
      ],
      overwrite: false,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      saved: Array<{ filename: string; path: string }>;
      warnings: Array<{ filename: string; message: string }>;
    };
    expect(payload.saved).toHaveLength(1);
    expect(payload.warnings).toHaveLength(0);
    expect(payload.saved[0]?.filename).toBe('2026-04-28_slack_bug_login_001.json');

    const filePath = path.resolve(
      outputAbsoluteDir,
      'slack',
      '2026-04-28_slack_bug_login_001.json',
    );
    const fileRaw = await readFile(filePath, 'utf8');
    expect(fileRaw.endsWith('\n')).toBe(true);
    expect(fileRaw).toContain('\n  "nested": {\n');
  });

  it('rejects non-json filename', async () => {
    const response = await postSave({
      source: 'jira',
      items: [{ filename: 'bad.txt', content: { ok: true } }],
      overwrite: false,
    });
    expect(response.status).toBe(400);
  });

  it('rejects jsonl filename', async () => {
    const response = await postSave({
      source: 'jira',
      items: [{ filename: 'bad.jsonl', content: { ok: true } }],
      overwrite: false,
    });
    expect(response.status).toBe(400);
  });

  it('rejects traversal and unsafe separators', async () => {
    const badFilenames = ['../x.json', 'a/b.json', 'a\\b.json'];
    for (const filename of badFilenames) {
      const response = await postSave({
        source: 'intercom',
        items: [{ filename, content: { ok: true } }],
      });
      expect(response.status).toBe(400);
    }
  });

  it('rejects invalid source', async () => {
    const response = await postSave({
      source: 'unknown',
      items: [{ filename: 'ok.json', content: { ok: true } }],
      overwrite: false,
    });
    expect(response.status).toBe(400);
  });

  it('does not overwrite existing file when overwrite=false and returns warning', async () => {
    const targetDir = path.resolve(outputAbsoluteDir, 'upvoty');
    await mkdir(targetDir, { recursive: true });
    const filePath = path.resolve(targetDir, '2026-04-28_upvoty_bug_x_001.json');
    await writeFile(filePath, '{\n  "marker": "existing"\n}\n', 'utf8');

    const response = await postSave({
      source: 'upvoty',
      items: [{ filename: '2026-04-28_upvoty_bug_x_001.json', content: { marker: 'new' } }],
      overwrite: false,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      saved: Array<{ filename: string; path: string }>;
      warnings: Array<{ filename: string; message: string }>;
    };
    expect(payload.saved).toHaveLength(0);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]?.message).toContain('overwrite is false');

    const afterRaw = await readFile(filePath, 'utf8');
    expect(afterRaw).toContain('"existing"');
  });

  it('overwrites existing file when overwrite=true', async () => {
    const targetDir = path.resolve(outputAbsoluteDir, 'jira');
    await mkdir(targetDir, { recursive: true });
    const filePath = path.resolve(targetDir, '2026-04-28_jira_bug_x_001.json');
    await writeFile(filePath, '{\n  "marker": "existing"\n}\n', 'utf8');

    const response = await postSave({
      source: 'jira',
      items: [{ filename: '2026-04-28_jira_bug_x_001.json', content: { marker: 'new' } }],
      overwrite: true,
    });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      saved: Array<{ filename: string; path: string }>;
      warnings: Array<{ filename: string; message: string }>;
    };
    expect(payload.saved).toHaveLength(1);
    expect(payload.warnings).toHaveLength(0);

    const afterRaw = await readFile(filePath, 'utf8');
    expect(afterRaw).toContain('"new"');
  });

  it('returns saved filenames and relative paths', async () => {
    const response = await postSave({
      source: 'slack',
      items: [{ filename: '2026-04-28_slack_bug_login_009.json', content: { ok: true } }],
      overwrite: false,
    });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      saved: Array<{ filename: string; path: string }>;
      warnings: Array<{ filename: string; message: string }>;
    };

    expect(payload.saved[0]?.filename).toBe('2026-04-28_slack_bug_login_009.json');
    expect(payload.saved[0]?.path.includes('apps/playground/')).toBe(true);
    expect(payload.saved[0]?.path.endsWith('/slack/2026-04-28_slack_bug_login_009.json')).toBe(
      true,
    );
    expect(payload.warnings).toHaveLength(0);
  });

  it('preserves content as received aside from JSON formatting', async () => {
    const content = {
      root: {
        arr: [1, 2, 3],
        nested: {
          x: 'value',
          y: true,
        },
      },
    };
    const response = await postSave({
      source: 'intercom',
      items: [{ filename: '2026-04-28_intercom_feedback_x_001.json', content }],
      overwrite: false,
    });
    expect(response.status).toBe(200);

    const filePath = path.resolve(
      outputAbsoluteDir,
      'intercom',
      '2026-04-28_intercom_feedback_x_001.json',
    );
    const written = await readFile(filePath, 'utf8');
    expect(JSON.parse(written)).toEqual(content);
  });
});
