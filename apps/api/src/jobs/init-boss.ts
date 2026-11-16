import { PgBoss } from 'pg-boss';

// The grants from Backend Schema §11.1, so the runtime role can use the tables pg-boss creates.
const GRANTS = `
  GRANT USAGE ON SCHEMA pgboss TO app_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO app_runtime;
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO app_runtime;
`;

/**
 * Install pg-boss's own schema, or bring it up to the version in the lockfile, and give the runtime role its grants
 * (Backend Schema §11). Run by the migration owner (`DIRECT_URL`) at deploy with `pnpm db:boss:init`, and again after every
 * pg-boss upgrade, because the runtime role cannot create or migrate the schema. Safe to run twice.
 */
export async function initBoss(connectionString: string): Promise<void> {
  // Only the install: no maintenance timers, no cron, no registry row.
  const boss = new PgBoss({ connectionString, max: 1, supervise: false, schedule: false, registerInstance: false });
  try {
    await boss.start();
    await boss.getDb().executeSql(GRANTS);
  } finally {
    await boss.stop({ graceful: false });
  }
}
