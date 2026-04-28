import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { buildTemplatePreview, extractTemplateMetadata, type TemplateMetadata } from './metadata';
import { FIXTURE_SOURCE_DEFS, type FixtureSource } from './sources';

const JsonObjectSchema = z.record(z.string(), z.unknown());

export interface LoadedTemplateResult {
  source: FixtureSource;
  status: 'loaded';
  templatePath: string;
  metadata: TemplateMetadata;
  preview: unknown;
}

export interface RawLoadedTemplateResult {
  source: FixtureSource;
  templatePath: string;
  template: Record<string, unknown>;
}

export class TemplateLoadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function resolveRepoRoot(startDir: string): string {
  return path.resolve(startDir, '..', '..');
}

export function parseTemplateJson(raw: string, source: FixtureSource): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TemplateLoadError(
      422,
      'template_invalid_json',
      `Template for source "${source}" contains invalid JSON.`,
    );
  }

  const validated = JsonObjectSchema.safeParse(parsed);
  if (!validated.success) {
    throw new TemplateLoadError(
      422,
      'template_invalid_shape',
      `Template for source "${source}" must be a top-level JSON object.`,
    );
  }
  return validated.data;
}

export async function loadTemplateForSource(
  source: FixtureSource,
  opts?: { repoRoot?: string },
): Promise<LoadedTemplateResult> {
  const raw = await loadRawTemplateForSource(source, opts);
  return {
    source: raw.source,
    status: 'loaded',
    templatePath: raw.templatePath,
    metadata: extractTemplateMetadata(raw.template),
    preview: buildTemplatePreview(raw.template),
  };
}

export async function loadRawTemplateForSource(
  source: FixtureSource,
  opts?: { repoRoot?: string },
): Promise<RawLoadedTemplateResult> {
  const def = FIXTURE_SOURCE_DEFS[source];
  const repoRoot = opts?.repoRoot ?? resolveRepoRoot(process.cwd());
  const absolutePath = path.resolve(repoRoot, def.templateRelativePath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch {
    throw new TemplateLoadError(
      404,
      'template_not_found',
      `Template file for source "${source}" was not found.`,
    );
  }

  const template = parseTemplateJson(raw, source);
  return {
    source,
    templatePath: def.templateRelativePath,
    template,
  };
}
