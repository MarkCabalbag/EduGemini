import { defineConfig } from 'vitest/config';

// Unit tests never read .env. The database tests load it themselves (apps/api/src/test/global-setup.ts).
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
