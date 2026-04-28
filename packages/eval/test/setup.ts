import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const envPath = resolve(repoRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Route @repo/db at the eval database before any module that imports it loads.
// vitest runs setupFiles before the test file's top-level imports resolve.
// `postgres()` connects lazily, so a placeholder URL keeps offline tests
// loadable when DATABASE_URL_EVAL is not set.
const placeholder = 'postgresql://eval:eval@127.0.0.1:1/eval-placeholder';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL_EVAL'] ?? process.env['DATABASE_URL'] ?? placeholder;
