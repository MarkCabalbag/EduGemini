import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApproveAllResultSchema,
  ClassSettingsResultSchema,
  EnrollmentViewSchema,
  PeoplePageSchema,
  TERMS_VERSION,
  type EnrollmentStatus,
  type Role,
} from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const EMAIL_END = `-${randomUUID().slice(0, 8)}@example.test`;

const db = createTestDb();

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () => createApp({ env: { APP_URL }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });

/** A user with a live session, made straight in the database so no password has to be hashed. */
async function signedInUser(name: string, role: Role) {
  const user = await db.user.create({
    data: {
      email: `${name}${EMAIL_END}`,
      firstName: 'Ada',
      lastName: name,
      role,
      termsAcceptedAt: new Date(), // the database requires it (users_terms_required)
      termsVersion: TERMS_VERSION,
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${await createSession(db, user.id)}` };
}

let seeded = 0;
const seedClass = (overrides: Partial<Prisma.ClassUncheckedCreateInput> = {}) =>
  db.class.create({
    data: { instructorId: owner.user.id, name: `People ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date(), ...overrides },
  });

/** A new student, already in the class in the given state. */
async function enroll(classId: string, status: EnrollmentStatus, joinedAt?: Date) {
  const { user } = await signedInUser(`s${++seeded}`, 'STUDENT');
  return db.enrollment.create({ data: { classId, studentId: user.id, status, joinedAt } });
}

const send = (method: 'get' | 'post' | 'patch', path: string, cookie: string) => {
  const req = request(build())[method](`/api${path}`).set('Cookie', cookie);
  return method === 'get' ? req : req.set('Origin', APP_URL);
};
const settings = (classId: string, body: object, cookie = owner.cookie) => send('patch', `/classes/${classId}/settings`, cookie).send(body);
const people = (classId: string, query = '', cookie = owner.cookie) => send('get', `/classes/${classId}/people${query}`, cookie);
const decide = (enrollmentId: string, action: unknown, cookie = owner.cookie) =>
  send('post', `/enrollments/${enrollmentId}/decision`, cookie).send({ action });
const approveAll = (classId: string, cookie = owner.cookie) => send('post', `/classes/${classId}/approve-pending`, cookie);

let owner: Awaited<ReturnType<typeof signedInUser>>;
let other: typeof owner;
let student: typeof owner;

beforeAll(async () => {
  await db.$connect();
  owner = await signedInUser('owner', 'INSTRUCTOR');
  other = await signedInUser('other', 'INSTRUCTOR');
  student = await signedInUser('student', 'STUDENT');
});

afterAll(async () => {
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // enrollments cascade; a class blocks deleting its instructor
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } }); // sessions cascade
  await db.$disconnect();
});

describe('change join approval (API Spec CLS-10)', () => {
  it('turns approval on and stores it', async () => {
    const klass = await seedClass();

    const res = await settings(klass.id, { requireApproval: true });

    expect(res.status).toBe(200);
    expect(ClassSettingsResultSchema.parse(res.body)).toEqual({ requireApproval: true, pendingCount: 0 });
    expect((await db.class.findUniqueOrThrow({ where: { id: klass.id } })).requireApproval).toBe(true);
  });

  it('leaves the students already in the class as they are, and says how many are still pending', async () => {
    const klass = await seedClass({ requireApproval: true });
    await enroll(klass.id, 'ACTIVE');
    await enroll(klass.id, 'PENDING');
    await enroll(klass.id, 'PENDING');

    const off = await settings(klass.id, { requireApproval: false });
    const on = await settings(klass.id, { requireApproval: true });

    expect(off.body).toEqual({ requireApproval: false, pendingCount: 2 });
    expect(on.body).toEqual({ requireApproval: true, pendingCount: 2 });
    const rows = await db.enrollment.findMany({ where: { classId: klass.id }, orderBy: { joinedAt: 'asc' } });
    expect(rows.map((row) => row.status)).toEqual(['ACTIVE', 'PENDING', 'PENDING']);
  });

  it('refuses an archived class with CLASS_ARCHIVED', async () => {
    const klass = await seedClass({ archivedAt: new Date() });

    const res = await settings(klass.id, { requireApproval: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
  });

  it.each([{}, { requireApproval: 'yes' }, { requireApproval: null }])('rejects the body %j', async (body) => {
    const klass = await seedClass();

    const res = await settings(klass.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('list people (API Spec PPL-01)', () => {
  it('lists every student with name and email, and complete counts', async () => {
    const klass = await seedClass();
    await enroll(klass.id, 'ACTIVE');
    await enroll(klass.id, 'ACTIVE');
    const pending = await enroll(klass.id, 'PENDING');
    await enroll(klass.id, 'DECLINED');
    await enroll(klass.id, 'REMOVED');

    const res = await people(klass.id);

    expect(res.status).toBe(200);
    const page = PeoplePageSchema.parse(res.body);
    expect(page.counts).toEqual({ approved: 2, pending: 1, declined: 1, removed: 1 });
    expect(page.items).toHaveLength(5);
    const row = page.items.find((item) => item.id === pending.id);
    expect(row).toMatchObject({ status: 'PENDING', decidedAt: null });
    expect(row?.student.email).toMatch(new RegExp(`^s\\d+${EMAIL_END}$`));
    expect(row?.student.displayName).toMatch(/^Ada s\d+$/);
  });

  it('filters by status and still returns the counts of every state', async () => {
    const klass = await seedClass();
    await enroll(klass.id, 'ACTIVE');
    const pending = await enroll(klass.id, 'PENDING');

    const res = await people(klass.id, '?status=PENDING');

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([pending.id]);
    expect(res.body.counts).toEqual({ approved: 1, pending: 1, declined: 0, removed: 0 });
  });

  it('pages oldest first, with a cursor for the next page', async () => {
    const klass = await seedClass();
    const base = Date.now() - 60_000;
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await enroll(klass.id, 'ACTIVE', new Date(base + i * 1000)));

    const first = await people(klass.id, '?limit=2');
    const second = await people(klass.id, `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);

    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([rows[0]!.id, rows[1]!.id]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([rows[2]!.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not issue, and an unknown status', async () => {
    const klass = await seedClass();

    expect((await people(klass.id, '?cursor=nonsense')).body.error.fields).toHaveProperty(['query.cursor']);
    expect((await people(klass.id, '?status=GONE')).status).toBe(400);
  });
});

describe('change an enrollment decision (API Spec PPL-02)', () => {
  it.each([
    ['APPROVE', 'PENDING', 'ACTIVE'],
    ['DECLINE', 'PENDING', 'DECLINED'],
    ['REVERSE', 'DECLINED', 'ACTIVE'],
    ['REVERSE', 'REMOVED', 'ACTIVE'],
    ['REMOVE', 'ACTIVE', 'REMOVED'],
  ] as const)('%s moves %s to %s and records who decided', async (action, from, to) => {
    const klass = await seedClass();
    const row = await enroll(klass.id, from);

    const res = await decide(row.id, action);

    expect(res.status).toBe(200);
    expect(EnrollmentViewSchema.parse(res.body)).toMatchObject({ id: row.id, status: to });
    expect(res.body.decidedAt).not.toBeNull();
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: to, decidedById: owner.user.id });
  });

  it.each([
    ['APPROVE', 'ACTIVE'],
    ['APPROVE', 'DECLINED'],
    ['APPROVE', 'REMOVED'],
    ['DECLINE', 'ACTIVE'],
    ['DECLINE', 'DECLINED'],
    ['REVERSE', 'PENDING'],
    ['REVERSE', 'ACTIVE'],
    ['REMOVE', 'PENDING'],
    ['REMOVE', 'DECLINED'],
    ['REMOVE', 'REMOVED'],
  ] as const)('refuses %s on a %s student with CONFLICT and changes nothing', async (action, from) => {
    const klass = await seedClass();
    const row = await enroll(klass.id, from);

    const res = await decide(row.id, action);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { currentState: from } });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(from);
  });

  it('lets only one of two decisions at once win', async () => {
    const klass = await seedClass();
    const row = await enroll(klass.id, 'PENDING');

    const [first, second] = await Promise.all([decide(row.id, 'APPROVE'), decide(row.id, 'DECLINE')]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    const winner = first.status === 200 ? first : second;
    expect(loser.body.error.details.currentState).toBe(winner.body.status);
  });

  it('rejects an unknown action and an id that is not a UUID', async () => {
    const klass = await seedClass();
    const row = await enroll(klass.id, 'PENDING');

    expect((await decide(row.id, 'DELETE')).status).toBe(400);
    expect((await decide('not-an-id', 'APPROVE')).status).toBe(400);
  });
});

describe('approve all pending (API Spec PPL-03)', () => {
  it('approves every pending student once approval is off, and nobody else', async () => {
    const klass = await seedClass({ requireApproval: false });
    const a = await enroll(klass.id, 'PENDING');
    const b = await enroll(klass.id, 'PENDING');
    const declined = await enroll(klass.id, 'DECLINED');

    const res = await approveAll(klass.id);

    expect(res.status).toBe(200);
    expect(ApproveAllResultSchema.parse(res.body)).toEqual({ approvedCount: 2 });
    const status = async (id: string) => (await db.enrollment.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(a.id), await status(b.id), await status(declined.id)]).toEqual(['ACTIVE', 'ACTIVE', 'DECLINED']);
  });

  it('refuses while approval is still on, and approves nobody', async () => {
    const klass = await seedClass({ requireApproval: true });
    const row = await enroll(klass.id, 'PENDING');

    const res = await approveAll(klass.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  });

  it('is not an error when nobody is pending', async () => {
    const klass = await seedClass();

    expect((await approveAll(klass.id)).body).toEqual({ approvedCount: 0 });
  });
});

describe('who may use these routes (API Spec A3)', () => {
  it('shows the owner the counts on the class itself', async () => {
    const klass = await seedClass();
    await enroll(klass.id, 'ACTIVE');
    await enroll(klass.id, 'PENDING');

    const res = await send('get', `/classes/${klass.id}`, owner.cookie);

    expect(res.body.counts).toEqual({ approved: 1, pending: 1, declined: 0, removed: 0 });
  });

  // Another instructor's class, a student, and a class that does not exist all answer the same: not found.
  it.each([
    ['another instructor', () => other.cookie],
    ['a student', () => student.cookie],
  ])('answers %s with NOT_FOUND on every route and changes nothing', async (_who, cookie) => {
    const klass = await seedClass({ requireApproval: false });
    const row = await enroll(klass.id, 'PENDING');

    const responses = [
      await settings(klass.id, { requireApproval: true }, cookie()),
      await people(klass.id, '', cookie()),
      await decide(row.id, 'APPROVE', cookie()),
      await approveAll(klass.id, cookie()),
    ];

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
    expect((await db.class.findUniqueOrThrow({ where: { id: klass.id } })).requireApproval).toBe(false);
  });

  it('answers a class or enrollment that does not exist with NOT_FOUND', async () => {
    const missing = randomUUID();

    expect((await people(missing)).status).toBe(404);
    expect((await decide(missing, 'APPROVE')).status).toBe(404);
  });

  it('needs a session', async () => {
    const klass = await seedClass();

    const res = await request(build()).get(`/api/classes/${klass.id}/people`);

    expect(res.status).toBe(401);
  });
});
