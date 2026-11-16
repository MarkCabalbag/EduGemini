import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBoss } from '../jobs/init-boss';
import { testDatabaseUrl } from './test-db';

/** Runs once before the integration tests: loads .env, then brings the test database up to the latest migration and installs pg-boss. */
export default async function setup() {
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  // Only `pnpm test:int` reads .env. `pnpm test` runs the unit project alone, so unit tests never see real credentials.
  // (Running both projects in one vitest command would share this process's environment.) CI sets the variables directly.
  try {
    process.loadEnvFile(resolve(apiDir, '../../.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const url = testDatabaseUrl(); // refuses to continue unless this is the test project

  const prismaCli = createRequire(resolve(apiDir, 'package.json')).resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'inherit',
  });

  // The same deploy step as `pnpm db:boss:init`, so the queue tests find pg-boss's schema.
  await initBoss(url);
}
