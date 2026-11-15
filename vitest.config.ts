import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests read E2E_DATABASE_URL from the root .env. CI sets the variables directly, so a missing file is fine.
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        // Real database, run one file at a time. Needs the test project (see apps/api/src/test/test-db.ts).
        test: {
          name: 'integration',
          include: ['apps/*/src/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['apps/api/src/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
