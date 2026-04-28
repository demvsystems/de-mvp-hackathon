import path from 'node:path';
import { listSavedFixtures } from './saved-fixtures';
import { resolveSaveBaseDir } from './save-fixtures';
import { FIXTURE_SOURCES, type FixtureSource } from './sources';

function resolveRepoRoot(startDir: string): string {
  return path.resolve(startDir, '..', '..');
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.split(path.sep).join('/');
}

export interface FixtureManifestIssueCounts {
  warning: number;
  error: number;
}

export interface FixtureManifestFixtureEntry {
  source: FixtureSource;
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  validationStatus: 'ok' | 'warning' | 'error' | null;
  issueCounts: FixtureManifestIssueCounts | null;
}

export interface FixtureManifestSourceSummary {
  count: number;
  valid: number;
  warning: number;
  error: number;
}

export interface FixtureManifestSummary {
  count: number;
  valid: number;
  warning: number;
  error: number;
  sizeBytes: number;
}

export interface FixtureManifest {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  sources: Record<FixtureSource, FixtureManifestSourceSummary>;
  summary: FixtureManifestSummary;
  fixtures: FixtureManifestFixtureEntry[];
}

export async function buildFixtureManifest(options?: {
  source?: FixtureSource;
  includeValidation?: boolean;
  repoRoot?: string;
}): Promise<FixtureManifest> {
  const repoRoot = options?.repoRoot ?? resolveRepoRoot(process.cwd());
  const includeValidation = options?.includeValidation ?? true;
  const list = await listSavedFixtures({
    ...(options?.source ? { source: options.source } : {}),
    includeContent: false,
    includeValidation,
    repoRoot,
  });

  const fixtures: FixtureManifestFixtureEntry[] = list.fixtures
    .map((fixture) => {
      if (!includeValidation) {
        return {
          source: fixture.source,
          filename: fixture.filename,
          path: fixture.path,
          sizeBytes: fixture.sizeBytes,
          modifiedAt: fixture.modifiedAt,
          validationStatus: null,
          issueCounts: null,
        };
      }

      const status = fixture.validation?.status ?? 'error';
      const issueCounts: FixtureManifestIssueCounts = {
        warning:
          fixture.validation?.issues.filter((issue) => issue.severity === 'warning').length ?? 0,
        error: fixture.validation?.issues.filter((issue) => issue.severity === 'error').length ?? 0,
      };

      return {
        source: fixture.source,
        filename: fixture.filename,
        path: fixture.path,
        sizeBytes: fixture.sizeBytes,
        modifiedAt: fixture.modifiedAt,
        validationStatus: status,
        issueCounts,
      };
    })
    .sort((a, b) => {
      const sourceSort = a.source.localeCompare(b.source);
      if (sourceSort !== 0) return sourceSort;
      return a.filename.localeCompare(b.filename);
    });

  const sources: Record<FixtureSource, FixtureManifestSourceSummary> = {
    jira: { count: 0, valid: 0, warning: 0, error: 0 },
    slack: { count: 0, valid: 0, warning: 0, error: 0 },
    upvoty: { count: 0, valid: 0, warning: 0, error: 0 },
    intercom: { count: 0, valid: 0, warning: 0, error: 0 },
  };

  const summary: FixtureManifestSummary = {
    count: 0,
    valid: 0,
    warning: 0,
    error: 0,
    sizeBytes: 0,
  };

  for (const fixture of fixtures) {
    const sourceStats = sources[fixture.source];
    sourceStats.count += 1;
    summary.count += 1;
    summary.sizeBytes += fixture.sizeBytes;

    if (!includeValidation || fixture.validationStatus === null) {
      continue;
    }

    if (fixture.validationStatus === 'ok') {
      sourceStats.valid += 1;
      summary.valid += 1;
      continue;
    }
    if (fixture.validationStatus === 'warning') {
      sourceStats.warning += 1;
      summary.warning += 1;
      continue;
    }
    sourceStats.error += 1;
    summary.error += 1;
  }

  for (const source of FIXTURE_SOURCES) {
    const sourceStats = sources[source];
    if (!includeValidation) {
      sourceStats.valid = 0;
      sourceStats.warning = 0;
      sourceStats.error = 0;
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: toRepoRelativePath(repoRoot, resolveSaveBaseDir(repoRoot)),
    sources,
    summary,
    fixtures,
  };
}
