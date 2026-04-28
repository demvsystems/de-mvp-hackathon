import { argv, exit } from 'node:process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { extractIntercomSnapshot } from '../src/pwx-splitter/intercom';
import { extractJiraSnapshot } from '../src/pwx-splitter/jira';
import { extractSlackSnapshot } from '../src/pwx-splitter/slack';
import { extractUpvotySnapshot } from '../src/pwx-splitter/upvoty';
import { PwxContainer } from '../src/pwx-splitter/types';

/**
 * CLI: liest alle pwx_ideen_*.json aus dem Eingangs-Verzeichnis,
 * extrahiert pro Container die vier Source-Sections in das jeweilige
 * Connector-Snapshot-Format und schreibt sie nach
 * `<output-dir>/<cluster>/{slack,jira,intercom,upvoty}.json`.
 *
 * Defaults sind auf das Repo-Layout abgestimmt (Eingang aus Dummyfiles,
 * Ausgang in Dummyfiles/pwx-clusters). Beide Pfade lassen sich überschreiben.
 *
 * Aufruf:
 *   pnpm --filter @repo/connectors run pwx:split
 *   pnpm --filter @repo/connectors run pwx:split -- --in <dir> --out <dir>
 */

const DEFAULT_INPUT_DIR = 'apps/playground/Dummyfiles';
const DEFAULT_OUTPUT_DIR = 'apps/playground/Dummyfiles/pwx-clusters';
const PWX_PREFIX = 'pwx_ideen_';

interface CliArgs {
  inDir: string;
  outDir: string;
}

function parseArgs(): CliArgs {
  const baseDir = process.env['INIT_CWD'] ?? process.cwd();
  const args = argv.slice(2);
  let inDir = DEFAULT_INPUT_DIR;
  let outDir = DEFAULT_OUTPUT_DIR;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--in' && value) {
      inDir = value;
      i++;
    } else if (flag === '--out' && value) {
      outDir = value;
      i++;
    } else if (flag === '--help' || flag === '-h') {
      printHelp();
      exit(0);
    }
  }
  return {
    inDir: isAbsolute(inDir) ? inDir : resolve(baseDir, inDir),
    outDir: isAbsolute(outDir) ? outDir : resolve(baseDir, outDir),
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @repo/connectors run pwx:split [--in <dir>] [--out <dir>]

Liest alle pwx_ideen_*.json aus <dir> (default: ${DEFAULT_INPUT_DIR}) und
schreibt pro Cluster vier Source-Snapshots nach <out>/<cluster>/.

Flags:
  --in <dir>    Eingangs-Verzeichnis mit pwx_ideen_*.json
  --out <dir>   Ausgangs-Verzeichnis (Default: ${DEFAULT_OUTPUT_DIR})
  --help        Diese Hilfe`);
}

async function listPwxFiles(inDir: string): Promise<string[]> {
  const entries = await readdir(inDir);
  return entries.filter((e) => e.startsWith(PWX_PREFIX) && e.endsWith('.json')).sort();
}

async function processFile(absPath: string, outDir: string): Promise<{ cluster: string }> {
  const raw = JSON.parse(await readFile(absPath, 'utf8')) as unknown;
  const container = PwxContainer.parse(raw);
  const targetDir = join(outDir, container.cluster);
  await mkdir(targetDir, { recursive: true });

  const sections: Array<{ name: string; produce: () => unknown }> = [
    {
      name: 'slack',
      produce: () => (container.slack !== undefined ? extractSlackSnapshot(raw) : undefined),
    },
    {
      name: 'jira',
      produce: () => (container.jira !== undefined ? extractJiraSnapshot(raw) : undefined),
    },
    {
      name: 'intercom',
      produce: () => (container.intercom !== undefined ? extractIntercomSnapshot(raw) : undefined),
    },
    {
      name: 'upvoty',
      produce: () => (container.upvoty !== undefined ? extractUpvotySnapshot(raw) : undefined),
    },
  ];

  for (const { name, produce } of sections) {
    const snapshot = produce();
    if (snapshot === undefined) continue;
    const targetFile = join(targetDir, `${name}.json`);
    await writeFile(targetFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  return { cluster: container.cluster };
}

async function main(): Promise<void> {
  const { inDir, outDir } = parseArgs();
  const files = await listPwxFiles(inDir);
  if (files.length === 0) {
    console.error(`Keine pwx_ideen_*.json in ${inDir} gefunden.`);
    exit(2);
  }
  console.error(`[pwx-split] ${files.length} Container in ${inDir} → ${outDir}`);
  for (const file of files) {
    const abs = join(inDir, file);
    try {
      const { cluster } = await processFile(abs, outDir);
      console.error(`  ${file} → ${cluster}/`);
    } catch (err) {
      console.error(`  ${file} FAIL:`, err instanceof Error ? err.message : err);
      exit(1);
    }
  }
  console.error('[pwx-split] done');
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
