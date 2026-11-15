import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './test-db';

/** Runs once before the integration tests: brings the test database up to the latest migration. */
export default function setup() {
  const url = testDatabaseUrl(); // refuses to continue unless this is the test project

  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const prismaCli = createRequire(resolve(apiDir, 'package.json')).resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'inherit',
  });
}
