import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    reporters: ['default'],
  },
});
