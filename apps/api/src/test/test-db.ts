import { PrismaClient } from '@prisma/client';

/**
 * The test database URL, after a safety check. Tests create and delete real rows, so they must never run
 * against the dev or production project (TRD §16.2a, code-standards §12).
 */
export function testDatabaseUrl(): string {
  const url = process.env['E2E_DATABASE_URL'];
  const ref = process.env['E2E_PROJECT_REF'];
  if (!url || !ref) {
    throw new Error('Integration tests need E2E_DATABASE_URL and E2E_PROJECT_REF (the edugemini-test project) in .env');
  }
  const parsed = new URL(url);
  if (parsed.port === '6543' || parsed.searchParams.has('pgbouncer')) {
    throw new Error(
      'E2E_DATABASE_URL must use the Supabase session pooler (port 5432, no ?pgbouncer=true). Migrations fail on the transaction pooler.',
    );
  }
  if (!decodeURIComponent(parsed.username).endsWith(`.${ref}`)) {
    throw new Error('E2E_DATABASE_URL does not belong to the project named by E2E_PROJECT_REF. Refusing to run.');
  }
  if (process.env['DIRECT_URL']?.includes(`.${ref}:`)) {
    throw new Error('E2E_PROJECT_REF is the same project as DIRECT_URL (dev). Refusing to run.');
  }
  return url;
}

export function createTestDb(): PrismaClient {
  return new PrismaClient({ datasourceUrl: testDatabaseUrl() });
}
