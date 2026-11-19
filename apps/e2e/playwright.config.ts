import { defineConfig, devices } from '@playwright/test';
import { testDatabaseUrl } from '../api/src/test/test-db';
import { API_PORT, API_URL, loadDotEnv, WEB_PORT, WEB_URL } from './utils/env';

// End-to-end tests run the real API and web app against the `edugemini-test` Supabase project, never the dev database.
// testDatabaseUrl() refuses to continue unless E2E_DATABASE_URL belongs to the test project (TRD §16.2a).
loadDotEnv();
const testDb = testDatabaseUrl();
const CI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  outputDir: './reports/results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: './reports/html', open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'API',
      command: 'pnpm --filter @edugemini/api exec tsx src/main.ts',
      url: `${API_URL}/healthz`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        APP_URL: WEB_URL,
        DATABASE_URL: testDb,
        DIRECT_URL: testDb,
        PGBOSS_URL: testDb,
        // Grading uses the fake Gemini: no key, no quota, a known result (85% of the maximum score).
        GEMINI_MODE: 'fake',
        LOG_LEVEL: 'warn',
      },
    },
    {
      name: 'Web',
      command: `pnpm --filter @edugemini/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { API_PROXY_TARGET: API_URL },
    },
  ],
});
