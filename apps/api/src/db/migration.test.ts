import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Applies the committed migration to an in-memory Postgres (PGlite), so schema and SQL mistakes
// fail in `pnpm test` without a Supabase project. The real databases are covered by the integration project.
const MIGRATION = resolve(__dirname, '../../prisma/migrations/20261115000000_init/migration.sql');

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(MIGRATION, 'utf8'));
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function rejects(sql: string, pattern: RegExp) {
  await expect(db.exec(sql)).rejects.toThrow(pattern);
}

describe('init migration', () => {
  it('creates all 22 tables with row-level security on', async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND rowsecurity`,
    );
    expect(rows[0]?.n).toBe(22);
  });

  it('keeps audit rows for 12 months: no updates, no early deletes, old rows can go', async () => {
    await db.exec(`INSERT INTO audit_logs (id, action, target_type, created_at) VALUES
      (gen_random_uuid(), 'OLD', 'x', now() - interval '13 months'),
      (gen_random_uuid(), 'NEW', 'x', now())`);
    await rejects(`UPDATE audit_logs SET reason = 'x' WHERE action = 'NEW'`, /append-only/);
    await rejects(`DELETE FROM audit_logs WHERE action = 'NEW'`, /append-only/);
    await db.exec(`DELETE FROM audit_logs WHERE action = 'OLD'`);
    const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_logs');
    expect(rows.map((r) => r.action)).toEqual(['NEW']);
  });

  it('rejects an email that is not lower case', async () => {
    await rejects(
      `INSERT INTO users (id, email, first_name, last_name, role, terms_accepted_at, updated_at)
       VALUES (gen_random_uuid(), 'Mixed@Case.com', 'A', 'B', 'STUDENT', now(), now())`,
      /users_email_lower/,
    );
  });
});
