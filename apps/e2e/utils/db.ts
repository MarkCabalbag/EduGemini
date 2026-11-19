import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../api/src/auth/password';
import { createTestDb } from '../../api/src/test/test-db';
import { PASSWORD } from './api';

// Users are written straight into the test database instead of through sign-up. Sign-up is limited to 60 an hour per IP
// and class creation to 20 an hour per user, in the API's memory, so a run that signed everyone up would trip the limits
// after a few repeats. A fresh user per test also keeps tests independent (TRD §16.2a).

export type Role = 'INSTRUCTOR' | 'STUDENT';
export type TestUser = { id: string; email: string; firstName: string; role: Role };
/** The API's Prisma client, typed through the API's own helper, since this package does not depend on Prisma. */
export type TestDb = ReturnType<typeof createTestDb>;

export function openTestDb(): TestDb {
  return createTestDb(); // refuses to run unless this is the test project
}

export const uniqueEmail = (label: string) => `e2e-${label}-${randomUUID().slice(0, 8)}@example.test`;

export async function insertUser(db: TestDb, role: Role): Promise<TestUser> {
  const firstName = role === 'INSTRUCTOR' ? 'Ines' : 'Sam';
  const user = await db.user.create({
    data: {
      email: uniqueEmail(role.toLowerCase()),
      passwordHash: await hashPassword(PASSWORD),
      firstName,
      lastName: 'Tester',
      role,
      termsAcceptedAt: new Date(),
      termsVersion: 'e2e',
    },
    select: { id: true, email: true },
  });
  return { ...user, firstName, role };
}

/** Removes test users. Their classes must be deleted first (through the API, so stored files are queued for deletion). */
export async function deleteUsers(db: TestDb, emails: string[]): Promise<void> {
  if (emails.length > 0) await db.user.deleteMany({ where: { email: { in: emails } } });
}
