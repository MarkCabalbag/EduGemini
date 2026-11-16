import type * as NodeCrypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClassSummarySchema, TERMS_VERSION, type EnrollmentStatus, type Role } from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { createClass, newJoinCode, regenerateCode } from './class-service';

// Join codes are random, so a test that needs a collision has to control the randomness. Node's randomInt is outside our
// code, so this replaces only that. While `forceUntil` is ahead of `calls`, every pick is the last character of the
// alphabet and the code is TAKEN_CODE. Otherwise it is the real randomInt.
const TAKEN_CODE = '99999999';
const randomness = vi.hoisted(() => ({ calls: 0, forceUntil: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return {
    ...actual,
    randomInt: (max: number) => (++randomness.calls <= randomness.forceUntil ? max - 1 : actual.randomInt(max)),
  };
});

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
      lastName: 'Lovelace',
      role,
      termsAcceptedAt: new Date(), // the database requires it (users_terms_required)
      termsVersion: TERMS_VERSION,
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${await createSession(db, user.id)}` };
}

let owner: Awaited<ReturnType<typeof signedInUser>>;
let other: typeof owner;
let student: typeof owner;

let seeded = 0;
const seedClass = (overrides: Partial<Prisma.ClassUncheckedCreateInput> = {}) =>
  db.class.create({
    data: { instructorId: owner.user.id, name: `Code ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date(), ...overrides },
  });

/** A new student, already in the class in the given state. */
async function enroll(classId: string, status: EnrollmentStatus) {
  const { user } = await signedInUser(`member${++seeded}`, 'STUDENT');
  return db.enrollment.create({ data: { classId, studentId: user.id, status } });
}

const stored = (classId: string) => db.class.findUniqueOrThrow({ where: { id: classId } });
const post = (action: 'regenerate' | 'disable', classId: string, cookie?: string) => {
  const req = request(build()).post(`/api/classes/${classId}/code/${action}`).set('Origin', APP_URL);
  return cookie ? req.set('Cookie', cookie) : req;
};
const regenerate = (classId: string, cookie = owner.cookie) => post('regenerate', classId, cookie);
const disable = (classId: string, cookie = owner.cookie) => post('disable', classId, cookie);

const join = (code: string, cookie: string) =>
  request(build()).post('/api/join').set('Origin', APP_URL).set('Cookie', cookie).send({ code });
const preview = (code: string) => request(build()).get(`/api/join/${code}`);
const expectInvalidCode = (res: request.Response) => {
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('INVALID_JOIN_CODE');
};

beforeAll(async () => {
  await db.$connect();
  owner = await signedInUser('owner', 'INSTRUCTOR');
  other = await signedInUser('other', 'INSTRUCTOR');
  student = await signedInUser('student', 'STUDENT');
  // Clear a taken code left over from an interrupted run. Only classes of test accounts (@example.test) are touched.
  await db.class.deleteMany({ where: { joinCode: TAKEN_CODE, instructor: { email: { endsWith: '@example.test' } } } });
});

afterEach(() => {
  randomness.forceUntil = 0;
});

afterAll(async () => {
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // enrollments cascade; a class blocks deleting its instructor
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } }); // sessions cascade
  await db.$disconnect();
});

describe('regenerate the join code (API Spec CLS-08)', () => {
  it('gives the class a new code and a link that follows it, switched on', async () => {
    const klass = await seedClass();

    const res = await regenerate(klass.id);

    expect(res.status).toBe(200);
    const body = ClassSummarySchema.parse(res.body);
    expect(body.id).toBe(klass.id);
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.joinCode).not.toBe(klass.joinCode);
    expect(body.joinLink).toBe(`${APP_URL}/join/${body.joinCode}`);
    expect(body.joinCodeActive).toBe(true);
    expect(await stored(klass.id)).toMatchObject({ joinCode: body.joinCode, joinCodeActive: true });
  });

  it('stops the old code at once, in joining and in the join link, and the new one works', async () => {
    const klass = await seedClass({ name: 'Chemistry' });
    const first = await signedInUser('regen-first', 'STUDENT');
    const second = await signedInUser('regen-second', 'STUDENT');

    const { body } = await regenerate(klass.id);

    expectInvalidCode(await join(klass.joinCode, first.cookie));
    expectInvalidCode(await preview(klass.joinCode));
    expect((await preview(body.joinCode)).body).toMatchObject({ className: 'Chemistry' });
    expect((await join(body.joinCode, second.cookie)).status).toBe(201);
    expect(await db.enrollment.count({ where: { classId: klass.id, studentId: first.user.id } })).toBe(0);
  });

  it('switches a disabled code on again', async () => {
    const klass = await seedClass({ joinCodeActive: false });
    const { cookie } = await signedInUser('regen-disabled', 'STUDENT');

    const res = await regenerate(klass.id);

    expect(res.body).toMatchObject({ joinCodeActive: true });
    expect(await stored(klass.id)).toMatchObject({ joinCodeActive: true });
    expect((await join(res.body.joinCode, cookie)).status).toBe(201);
  });

  it('leaves every student, whatever their state, and the approval setting as they were', async () => {
    const klass = await seedClass({ requireApproval: true });
    const states: EnrollmentStatus[] = ['ACTIVE', 'PENDING', 'DECLINED', 'REMOVED'];
    for (const status of states) await enroll(klass.id, status);
    const before = await db.enrollment.findMany({ where: { classId: klass.id }, orderBy: { studentId: 'asc' } });

    await regenerate(klass.id);

    expect(await db.enrollment.findMany({ where: { classId: klass.id }, orderBy: { studentId: 'asc' } })).toEqual(before);
    expect((await stored(klass.id)).requireApproval).toBe(true);
  });

  it('keeps an approved student able to open the class', async () => {
    const klass = await seedClass();
    const member = await signedInUser('regen-member', 'STUDENT');
    await db.enrollment.create({ data: { classId: klass.id, studentId: member.user.id, status: 'ACTIVE' } });

    await regenerate(klass.id);

    const res = await request(build()).get(`/api/classes/${klass.id}`).set('Cookie', member.cookie);
    expect(res.status).toBe(200);
  });

  it('refuses an archived class with CLASS_ARCHIVED, and changes nothing', async () => {
    const klass = await seedClass({ archivedAt: new Date() });

    const res = await regenerate(klass.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    expect(await stored(klass.id)).toMatchObject({ joinCode: klass.joinCode, joinCodeActive: true });
  });

  it('is NOT_FOUND to another instructor, a student and a missing class, and changes nothing', async () => {
    const klass = await seedClass();

    const answers = [await regenerate(klass.id, other.cookie), await regenerate(klass.id, student.cookie), await regenerate(randomUUID())];

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await stored(klass.id)).joinCode).toBe(klass.joinCode);
  });

  it('needs a session, the web app as its origin, and a class id', async () => {
    const klass = await seedClass();

    expect((await post('regenerate', klass.id)).status).toBe(401);
    const noOrigin = await request(build()).post(`/api/classes/${klass.id}/code/regenerate`).set('Cookie', owner.cookie);
    expect(noOrigin.body.error.code).toBe('CSRF_ORIGIN');
    const badId = await regenerate('not-an-id');
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION');
    expect((await stored(klass.id)).joinCode).toBe(klass.joinCode);
  });

  it('uses the general rate limit', async () => {
    const klass = await seedClass();
    expect((await regenerate(klass.id)).headers['ratelimit-limit']).toBe('120');
  });

  it('keeps exactly one working code when two requests come at once', async () => {
    const klass = await seedClass();
    const { cookie } = await signedInUser('regen-race', 'STUDENT');

    const answers = await Promise.all([regenerate(klass.id), regenerate(klass.id)]);

    const codes = answers.map((res) => res.body.joinCode as string);
    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    expect(new Set(codes).size).toBe(2);
    const { joinCode } = await stored(klass.id);
    expect(codes).toContain(joinCode);
    const dead = codes.find((code) => code !== joinCode)!;
    expectInvalidCode(await join(dead, cookie));
    expect((await join(joinCode, cookie)).status).toBe(201);
  });

  describe('when the code it picks is taken', () => {
    const PICKS_PER_CODE = 8;
    const actor = () => ({ id: owner.user.id, role: 'INSTRUCTOR' as const });

    beforeAll(async () => {
      await seedClass({ joinCode: TAKEN_CODE });
    });

    it('picks another', async () => {
      const klass = await seedClass();
      randomness.calls = 0;
      randomness.forceUntil = 2 * PICKS_PER_CODE; // the first two codes are the taken one

      const made = await regenerateCode(db, actor(), klass.id, APP_URL);

      expect(made.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(made.joinCode).not.toBe(TAKEN_CODE);
      expect(randomness.calls).toBe(3 * PICKS_PER_CODE); // two taken codes, then a free one
      expect((await stored(klass.id)).joinCode).toBe(made.joinCode);
    });

    it('creating a class does the same, since the retry is shared with it (CLS-02)', async () => {
      randomness.calls = 0;
      randomness.forceUntil = PICKS_PER_CODE; // the first code is the taken one

      const made = await createClass(db, actor(), { name: 'Shared retry', attestation: { confirmed: true } }, APP_URL);

      expect(made.joinCode).not.toBe(TAKEN_CODE);
      expect(randomness.calls).toBe(2 * PICKS_PER_CODE);
    });

    it('gives up with INTERNAL after the first try and five retries, and the old code keeps working', async () => {
      const klass = await seedClass();
      randomness.calls = 0;
      randomness.forceUntil = Infinity;

      await expect(regenerateCode(db, actor(), klass.id, APP_URL)).rejects.toMatchObject({ code: 'INTERNAL' });

      expect(randomness.calls).toBe(6 * PICKS_PER_CODE);
      expect(await stored(klass.id)).toMatchObject({ joinCode: klass.joinCode, joinCodeActive: true });
    });
  });
});

describe('disable the join code (API Spec CLS-09)', () => {
  it('switches the code off and keeps it on the class, shown as off', async () => {
    const klass = await seedClass();

    const res = await disable(klass.id);

    expect(res.status).toBe(200);
    expect(ClassSummarySchema.parse(res.body)).toMatchObject({ id: klass.id, joinCode: klass.joinCode, joinCodeActive: false });
    expect(await stored(klass.id)).toMatchObject({ joinCode: klass.joinCode, joinCodeActive: false });
    const read = await request(build()).get(`/api/classes/${klass.id}`).set('Cookie', owner.cookie);
    expect(read.body.joinCodeActive).toBe(false);
  });

  it('makes the code read as invalid for everyone, with no class information', async () => {
    const klass = await seedClass({ name: 'Secret club' });
    const { cookie } = await signedInUser('disable-join', 'STUDENT');
    await disable(klass.id);

    const joined = await join(klass.joinCode, cookie);
    const previewed = await preview(klass.joinCode);
    const unknown = await preview('22222222');

    expectInvalidCode(joined);
    expectInvalidCode(previewed);
    expect(JSON.stringify([joined.body, previewed.body])).not.toContain('Secret club');
    expect(previewed.body.error.message).toBe(unknown.body.error.message); // the same as a code that never existed
    expect(await db.enrollment.count({ where: { classId: klass.id } })).toBe(0);
  });

  it('does nothing new the second time (200, the same answer)', async () => {
    const klass = await seedClass();

    const first = await disable(klass.id);
    const second = await disable(klass.id);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await stored(klass.id)).toMatchObject({ joinCode: klass.joinCode, joinCodeActive: false });
  });

  it('leaves every student, whatever their state, as they were', async () => {
    const klass = await seedClass();
    const states: EnrollmentStatus[] = ['ACTIVE', 'PENDING', 'DECLINED', 'REMOVED'];
    for (const status of states) await enroll(klass.id, status);
    const before = await db.enrollment.findMany({ where: { classId: klass.id }, orderBy: { studentId: 'asc' } });

    await disable(klass.id);

    expect(await db.enrollment.findMany({ where: { classId: klass.id }, orderBy: { studentId: 'asc' } })).toEqual(before);
  });

  it('can be switched on again with a new code, and only the new code works', async () => {
    const klass = await seedClass();
    const { cookie } = await signedInUser('disable-then-regen', 'STUDENT');

    await disable(klass.id);
    const { body } = await regenerate(klass.id);

    expectInvalidCode(await join(klass.joinCode, cookie));
    expect((await join(body.joinCode, cookie)).status).toBe(201);
  });

  it('refuses an archived class with CLASS_ARCHIVED, and changes nothing', async () => {
    const klass = await seedClass({ archivedAt: new Date() });

    const res = await disable(klass.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    expect((await stored(klass.id)).joinCodeActive).toBe(true);
  });

  it('is NOT_FOUND to another instructor, a student and a missing class, and changes nothing', async () => {
    const klass = await seedClass();

    const answers = [await disable(klass.id, other.cookie), await disable(klass.id, student.cookie), await disable(randomUUID())];

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await stored(klass.id)).joinCodeActive).toBe(true);
  });

  it('needs a session, the web app as its origin, and a class id', async () => {
    const klass = await seedClass();

    expect((await post('disable', klass.id)).status).toBe(401);
    const noOrigin = await request(build()).post(`/api/classes/${klass.id}/code/disable`).set('Cookie', owner.cookie);
    expect(noOrigin.body.error.code).toBe('CSRF_ORIGIN');
    const badId = await disable('not-an-id');
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION');
    expect((await stored(klass.id)).joinCodeActive).toBe(true);
  });

  it('uses the general rate limit', async () => {
    const klass = await seedClass();
    expect((await disable(klass.id)).headers['ratelimit-limit']).toBe('120');
  });
});
