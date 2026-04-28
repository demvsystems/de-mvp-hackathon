import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SaveFixtureRequest, SaveFixtureResponse } from './generate-schemas';
import { saveFixtureResponseSchema } from './generate-schemas';

function resolveRepoRoot(startDir: string): string {
  return path.resolve(startDir, '..', '..');
}

function assertWithin(baseDir: string, target: string): void {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  if (resolved === base) return;
  const withSep = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (!resolved.startsWith(withSep)) {
    throw new Error(`Path escapes base directory: ${target}`);
  }
}

function ensureSerializable(value: Record<string, unknown>): string {
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    throw new Error('content is not JSON serializable');
  }
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.split(path.sep).join('/');
}

export function resolveSaveBaseDir(repoRoot: string): string {
  const playgroundRoot = path.resolve(repoRoot, 'apps', 'playground');
  const overrideRaw = process.env['PLAYGROUND_FIXTURE_OUTPUT_DIR'];
  const candidate = overrideRaw
    ? path.resolve(playgroundRoot, overrideRaw)
    : path.resolve(playgroundRoot, 'fixtures', 'generated');
  assertWithin(playgroundRoot, candidate);
  return candidate;
}

export async function saveFixtures(
  input: SaveFixtureRequest,
  opts?: { repoRoot?: string },
): Promise<SaveFixtureResponse> {
  const repoRoot = opts?.repoRoot ?? resolveRepoRoot(process.cwd());
  const baseDir = resolveSaveBaseDir(repoRoot);
  const sourceDir = path.resolve(baseDir, input.source);
  assertWithin(baseDir, sourceDir);
  await mkdir(sourceDir, { recursive: true });

  const saved: Array<{ filename: string; path: string }> = [];
  const warnings: Array<{ filename: string; message: string }> = [];

  for (const item of input.items) {
    const targetPath = path.resolve(sourceDir, item.filename);
    assertWithin(sourceDir, targetPath);

    let exists = false;
    try {
      await access(targetPath);
      exists = true;
    } catch {
      exists = false;
    }

    if (exists && !input.overwrite) {
      warnings.push({
        filename: item.filename,
        message: 'File already exists and overwrite is false.',
      });
      continue;
    }

    const json = ensureSerializable(item.content);
    await writeFile(targetPath, json, 'utf8');
    saved.push({
      filename: item.filename,
      path: toRepoRelativePath(repoRoot, targetPath),
    });
  }

  return saveFixtureResponseSchema.parse({
    saved,
    warnings,
  });
}
