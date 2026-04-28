import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  fixtureSourceSchema,
  safeFixtureFilenameSchema,
  validationResultItemSchema,
} from './generate-schemas';
import { resolveSaveBaseDir } from './save-fixtures';
import { FIXTURE_SOURCES, type FixtureSource } from './sources';
import {
  validateGeneratedFixtures,
  type ValidationResultItem,
} from './validate-generated-fixtures';
import type { z } from 'zod';

type FixtureSourceFromSchema = z.infer<typeof fixtureSourceSchema>;

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

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.split(path.sep).join('/');
}

function asValidationError(filename: string, message: string): ValidationResultItem {
  return validationResultItemSchema.parse({
    filename,
    status: 'error',
    issues: [
      {
        severity: 'error',
        path: 'content',
        message,
      },
    ],
  });
}

function parseFixtureJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readFixtureFile(
  source: FixtureSource,
  filename: string,
  absolutePath: string,
): Promise<{
  content: Record<string, unknown> | null;
  validation: ValidationResultItem;
}> {
  const raw = await readFile(absolutePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseFixtureJson(raw);
  } catch {
    return {
      content: null,
      validation: asValidationError(filename, 'Saved fixture contains invalid JSON.'),
    };
  }

  if (!isObjectLike(parsed)) {
    return {
      content: null,
      validation: asValidationError(filename, 'Saved fixture JSON must be a top-level object.'),
    };
  }

  const validation = validateGeneratedFixtures({
    source,
    items: [{ filename, content: parsed }],
  })[0];

  return {
    content: parsed,
    validation:
      validation ??
      asValidationError(filename, 'Internal validation error while reading saved fixture.'),
  };
}

function getSourceList(source?: FixtureSourceFromSchema): FixtureSource[] {
  if (!source) return [...FIXTURE_SOURCES];
  return [source];
}

export interface SavedFixtureListItem {
  source: FixtureSource;
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  content?: Record<string, unknown> | null;
  validation?: ValidationResultItem;
}

export interface ListSavedFixturesOptions {
  source?: FixtureSourceFromSchema;
  includeContent?: boolean;
  includeValidation?: boolean;
  repoRoot?: string;
}

export async function listSavedFixtures(
  options: ListSavedFixturesOptions = {},
): Promise<{ fixtures: SavedFixtureListItem[] }> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot(process.cwd());
  const baseDir = resolveSaveBaseDir(repoRoot);
  const includeContent = options.includeContent ?? false;
  const includeValidation = options.includeValidation ?? true;

  const fixtures: SavedFixtureListItem[] = [];
  for (const source of getSourceList(options.source)) {
    const sourceDir = path.resolve(baseDir, source);
    assertWithin(baseDir, sourceDir);

    const entries = await readdir(sourceDir, { withFileTypes: true, encoding: 'utf8' }).catch(
      () => null,
    );
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filename = entry.name;
      const filenameParse = safeFixtureFilenameSchema.safeParse(filename);
      if (!filenameParse.success) continue;

      const absolutePath = path.resolve(sourceDir, filename);
      assertWithin(sourceDir, absolutePath);
      const fileStat = await stat(absolutePath);

      const result: SavedFixtureListItem = {
        source,
        filename,
        path: toRepoRelativePath(repoRoot, absolutePath),
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      };

      if (includeContent || includeValidation) {
        const parsed = await readFixtureFile(source, filename, absolutePath);
        if (includeContent) result.content = parsed.content;
        if (includeValidation) result.validation = parsed.validation;
      }

      fixtures.push(result);
    }
  }

  fixtures.sort((a, b) => {
    const dateSort = b.modifiedAt.localeCompare(a.modifiedAt);
    if (dateSort !== 0) return dateSort;
    return a.filename.localeCompare(b.filename);
  });

  return { fixtures };
}

export interface ReadSavedFixtureResult {
  source: FixtureSource;
  filename: string;
  path: string;
  content: Record<string, unknown>;
  validation: ValidationResultItem;
}

export class SavedFixtureError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) {
      this.details = details;
    }
  }
}

export async function readSavedFixture(args: {
  source: FixtureSourceFromSchema;
  filename: string;
  repoRoot?: string;
}): Promise<ReadSavedFixtureResult> {
  const filename = safeFixtureFilenameSchema.parse(args.filename);
  const repoRoot = args.repoRoot ?? resolveRepoRoot(process.cwd());
  const baseDir = resolveSaveBaseDir(repoRoot);
  const sourceDir = path.resolve(baseDir, args.source);
  assertWithin(baseDir, sourceDir);
  const absolutePath = path.resolve(sourceDir, filename);
  assertWithin(sourceDir, absolutePath);

  try {
    await stat(absolutePath);
  } catch {
    throw new SavedFixtureError(404, 'fixture_not_found', 'Saved fixture file was not found.');
  }

  const parsed = await readFixtureFile(args.source, filename, absolutePath);
  if (parsed.content === null) {
    throw new SavedFixtureError(422, 'fixture_invalid_json', 'Saved fixture JSON is invalid.', {
      validation: parsed.validation,
      path: toRepoRelativePath(repoRoot, absolutePath),
    });
  }

  return {
    source: args.source,
    filename,
    path: toRepoRelativePath(repoRoot, absolutePath),
    content: parsed.content,
    validation: parsed.validation,
  };
}

export async function deleteSavedFixture(args: {
  source: FixtureSourceFromSchema;
  filename: string;
  repoRoot?: string;
}): Promise<{ deleted: true; source: FixtureSource; filename: string }> {
  const filename = safeFixtureFilenameSchema.parse(args.filename);
  const repoRoot = args.repoRoot ?? resolveRepoRoot(process.cwd());
  const baseDir = resolveSaveBaseDir(repoRoot);
  const sourceDir = path.resolve(baseDir, args.source);
  assertWithin(baseDir, sourceDir);
  const absolutePath = path.resolve(sourceDir, filename);
  assertWithin(sourceDir, absolutePath);

  let entryStat;
  try {
    entryStat = await stat(absolutePath);
  } catch {
    throw new SavedFixtureError(404, 'fixture_not_found', 'Saved fixture file was not found.');
  }

  if (!entryStat.isFile()) {
    throw new SavedFixtureError(400, 'invalid_fixture_target', 'Target is not a file.');
  }

  await rm(absolutePath, { force: false });
  return {
    deleted: true,
    source: args.source,
    filename,
  };
}
