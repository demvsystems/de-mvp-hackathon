import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { manifestQuerySchema } from '@/lib/fixture/generate-schemas';
import { buildFixtureManifest } from '@/lib/fixture/fixture-manifest';
import { resolveSaveBaseDir } from '@/lib/fixture/save-fixtures';

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

export async function GET(request: Request) {
  const repoRoot = resolveRepoRoot(process.cwd());
  const { searchParams } = new URL(request.url);
  const parsed = manifestQuerySchema.safeParse({
    source: searchParams.get('source') ?? undefined,
    includeValidation: searchParams.get('includeValidation') ?? undefined,
    write: searchParams.get('write') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid manifest query.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const manifest = await buildFixtureManifest({
      ...(parsed.data.source ? { source: parsed.data.source } : {}),
      includeValidation: parsed.data.includeValidation,
      repoRoot,
    });

    if (!parsed.data.write) {
      return NextResponse.json(manifest, { status: 200 });
    }

    const baseDir = resolveSaveBaseDir(repoRoot);
    await mkdir(baseDir, { recursive: true });
    const manifestFilename = parsed.data.source
      ? `manifest.${parsed.data.source}.json`
      : 'manifest.json';
    const manifestPath = path.resolve(baseDir, manifestFilename);
    assertWithin(baseDir, manifestPath);

    const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestRaw, 'utf8');

    return NextResponse.json(
      {
        manifest,
        written: {
          filename: manifestFilename,
          path: toRepoRelativePath(repoRoot, manifestPath),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unexpected manifest error.',
      },
      { status: 400 },
    );
  }
}
