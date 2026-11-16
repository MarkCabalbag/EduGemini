import type * as NodeCrypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ClassPageSchema,
  ClassSummarySchema,
  EnrolledPageSchema,
  TERMS_VERSION,
  type CreateClass,
  type EnrollmentStatus,
  type Role,
} from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { RULES } from '../middleware/rate-limit';
import { createTestDb } from '../test/test-db';
import { createClass, newJoinCode } from './class-service';

// Join codes are random, so a test that needs a collision has to control the randomness. Node's randomInt is outside
// our code, so this replaces only that. While `forceZeroUntil` is ahead of `calls`, every pick is 0 and the code is
// AAAAAAAA. Otherwise it is the real randomInt.
const randomness = vi.hoisted(() => ({ calls: 0, forceZeroUntil: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return {
    ...actual,
    randomInt: (max: number) => (++randomness.calls <= randomness.forceZeroUntil ? 0 : actual.randomInt(max)),
  };
});

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;

const db = createTestDb();

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({ env: { APP_URL }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });
type TestApp = ReturnType<typeof build>;

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
  const cookie = `${SESSION_COOKIE}=${await createSession(db, user.id)}`;
  return { user, cookie };
}

/** A class made straight in the database, so a test controls its age and state. */
let seeded = 0;
const seed = (instructorId: string, overrides: Partial<Prisma.ClassUncheckedCreateInput> = {}) =>
  db.class.create({
    data: { instructorId, name: `Seeded ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date(), ...overrides },
  });

const validBody = (overrides: object = {}) => ({ name: 'Biology 101', attestation: { confirmed: true }, ...overrides });
const create = (app: TestApp, cookie: string, body: object) =>
  request(app).post('/api/classes').set('Origin', APP_URL).set('Cookie', cookie).send(body);
const get = (app: TestApp, cookie: string, path: string) => request(app).get(`/api${path}`).set('Cookie', cookie);

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
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // a class blocks deleting its instructor
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } }); // sessions cascade
  await db.$disconnect();
});

describe('create class (API Spec CLS-02)', () => {
  it('makes an active class with a join code and link, owned by the caller', async () => {
    const res = await create(build(), owner.cookie, validBody({ description: 'Cells', section: 'B', subject: 'Biology', room: '4' }));

    expect(res.status).toBe(201);
    const body = ClassSummarySchema.parse(res.body);
    expect(body).toMatchObject({
      name: 'Biology 101',
      description: 'Cells',
      section: 'B',
      subject: 'Biology',
      room: '4',
      status: 'ACTIVE',
      joinCodeActive: true,
      requireApproval: false,
    });
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.joinLink).toBe(`${APP_URL}/join/${body.joinCode}`);

    const row = await db.class.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.instructorId).toBe(owner.user.id);
    expect(Date.now() - row.attestedAt.getTime()).toBeLessThan(60_000); // the attestation time is recorded
  });

  it('trims the name and stores blank optional fields as null', async () => {
    const res = await create(build(), owner.cookie, validBody({ name: '  Chemistry  ', description: '   ', section: '' }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Chemistry', description: null, section: null, subject: null, room: null });
  });

  it('gives two classes different codes', async () => {
    const app = build();
    const first = await create(app, owner.cookie, validBody());
    const second = await create(app, owner.cookie, validBody());
    expect(first.body.joinCode).not.toBe(second.body.joinCode);
  });

  it.each([
    ['no attestation', { attestation: undefined }, 'attestation'],
    ['an attestation that is not ticked', { attestation: { confirmed: false } }, 'attestation.confirmed'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a name with a NUL character, which the database cannot store', { name: 'Bio\u0000' }, 'name'],
    ['a description with a NUL character', { description: 'a\u0000b' }, 'description'],
    ['a name with half an emoji, which cannot be stored either', { name: 'Bio\ud83d' }, 'name'],
    ['a name over 120 characters', { name: 'x'.repeat(121) }, 'name'],
    ['a description over 2000 characters', { description: 'x'.repeat(2001) }, 'description'],
    ['a section over 60 characters', { section: 'x'.repeat(61) }, 'section'],
    ['a subject over 60 characters', { subject: 'x'.repeat(61) }, 'subject'],
    ['a room over 60 characters', { room: 'x'.repeat(61) }, 'room'],
  ])('refuses %s', async (_label, overrides, field) => {
    const res = await create(build(), owner.cookie, validBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields).toHaveProperty([field]);
  });

  it('refuses a query parameter, since this route takes none (API Spec A2)', async () => {
    const res = await request(build()).post('/api/classes?x=1').set('Origin', APP_URL).set('Cookie', owner.cookie).send(validBody());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('creates nothing when the attestation is missing', async () => {
    const { user, cookie } = await signedInUser('no-attest', 'INSTRUCTOR');
    await create(build(), cookie, validBody({ attestation: undefined }));
    expect(await db.class.count({ where: { instructorId: user.id } })).toBe(0);
  });

  it('needs a session', async () => {
    const res = await request(build()).post('/api/classes').set('Origin', APP_URL).send(validBody());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['a good body', validBody()],
    ['an empty body', {}],
    ['a body that fails validation', validBody({ name: '' })],
  ])('is NOT_FOUND for a student who sends %s, so the route does not reveal itself (API Spec A3)', async (_label, body) => {
    const res = await create(build(), student.cookie, body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('allows 20 new classes an hour per user, then answers RATE_LIMITED; a request that fails validation is not counted', async () => {
    const { user, cookie } = await signedInUser('rate', 'INSTRUCTOR');
    const app = build();

    for (let i = 0; i < 3; i++) expect((await create(app, cookie, validBody({ name: '' }))).status).toBe(400);
    for (let i = 0; i < 20; i++) expect((await create(app, cookie, validBody())).status).toBe(201);
    const res = await create(app, cookie, validBody());

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(await db.class.count({ where: { instructorId: user.id } })).toBe(20);
  });

  it('refuses a request that does not come from the web app', async () => {
    const res = await request(build()).post('/api/classes').set('Cookie', owner.cookie).send(validBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });
});

describe('join code collisions', () => {
  const input: CreateClass = { name: 'Collision', attestation: { confirmed: true } };
  const PICKS_PER_CODE = 8;
  let actor: { id: string; role: Role };

  beforeAll(async () => {
    const { user } = await signedInUser('collide', 'INSTRUCTOR');
    actor = { id: user.id, role: 'INSTRUCTOR' };
    // The forced code is always AAAAAAAA, so clear any left over from an interrupted run, then take it.
    // Only classes of test accounts (the @example.test domain) are touched.
    await db.class.deleteMany({ where: { joinCode: 'AAAAAAAA', instructor: { email: { endsWith: '@example.test' } } } });
    await seed(user.id, { joinCode: 'AAAAAAAA' });
  });

  afterEach(() => {
    randomness.forceZeroUntil = 0;
  });

  it('tries another code when one is already taken', async () => {
    randomness.calls = 0;
    randomness.forceZeroUntil = 2 * PICKS_PER_CODE; // the first two codes are the taken AAAAAAAA

    const made = await createClass(db, actor, input, APP_URL);

    expect(made.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(made.joinCode).not.toBe('AAAAAAAA');
    expect(randomness.calls).toBe(3 * PICKS_PER_CODE); // two taken codes, then a free one
  });

  it('gives up with INTERNAL after the first try and five retries, without leaking the database error', async () => {
    randomness.calls = 0;
    randomness.forceZeroUntil = Infinity;

    await expect(createClass(db, actor, input, APP_URL)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(randomness.calls).toBe(6 * PICKS_PER_CODE);
  });
});

describe('list classes (API Spec CLS-01)', () => {
  it('lists only the caller\'s own active classes, newest first', async () => {
    const mine = await signedInUser('list-mine', 'INSTRUCTOR');
    const theirs = await signedInUser('list-theirs', 'INSTRUCTOR');
    const older = await seed(mine.user.id, { createdAt: new Date('2026-01-01T00:00:00Z') });
    const newer = await seed(mine.user.id, { createdAt: new Date('2026-02-01T00:00:00Z') });
    await seed(mine.user.id, { archivedAt: new Date() });
    await seed(theirs.user.id);

    const res = await get(build(), mine.cookie, '/classes');

    expect(res.status).toBe(200);
    const page = ClassPageSchema.parse(res.body);
    expect(page.items.map((c) => c.id)).toEqual([newer.id, older.id]);
    expect(page.items.every((c) => c.status === 'ACTIVE')).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('shows archived classes only when asked for', async () => {
    const { user, cookie } = await signedInUser('list-archived', 'INSTRUCTOR');
    await seed(user.id);
    const archived = await seed(user.id, { archivedAt: new Date() });

    const res = await get(build(), cookie, '/classes?status=ARCHIVED');

    const page = ClassPageSchema.parse(res.body);
    expect(page.items.map((c) => c.id)).toEqual([archived.id]);
    expect(page.items[0]?.status).toBe('ARCHIVED');
  });

  it('is an empty page for an instructor with no classes', async () => {
    const { cookie } = await signedInUser('list-empty', 'INSTRUCTOR');
    const res = await get(build(), cookie, '/classes');
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('pages through every class exactly once', async () => {
    const { user, cookie } = await signedInUser('list-paging', 'INSTRUCTOR');
    const made = [];
    for (let day = 1; day <= 5; day++) made.push(await seed(user.id, { createdAt: new Date(`2026-03-0${day}T00:00:00Z`) }));
    const app = build();

    const first = ClassPageSchema.parse((await get(app, cookie, '/classes?limit=2')).body);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = ClassPageSchema.parse((await get(app, cookie, `/classes?limit=2&cursor=${first.nextCursor}`)).body);
    expect(second.items).toHaveLength(2);
    const third = ClassPageSchema.parse((await get(app, cookie, `/classes?limit=2&cursor=${second.nextCursor}`)).body);
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(ids).toEqual(made.map((c) => c.id).reverse());
  });

  it('keeps paging after the class the cursor points at is archived or deleted', async () => {
    const { user, cookie } = await signedInUser('list-stable', 'INSTRUCTOR');
    const made = [];
    for (let day = 1; day <= 4; day++) made.push(await seed(user.id, { createdAt: new Date(`2026-04-0${day}T00:00:00Z`) }));
    const app = build();
    const first = ClassPageSchema.parse((await get(app, cookie, '/classes?limit=2')).body); // days 4 and 3; day 3 is the cursor
    const secondPage = async () =>
      ClassPageSchema.parse((await get(app, cookie, `/classes?limit=2&cursor=${first.nextCursor}`)).body).items.map((c) => c.id);

    await db.class.update({ where: { id: made[2]!.id }, data: { archivedAt: new Date() } });
    expect(await secondPage()).toEqual([made[1]!.id, made[0]!.id]);

    await db.class.delete({ where: { id: made[2]!.id } });
    expect(await secondPage()).toEqual([made[1]!.id, made[0]!.id]);
  });

  const cursorOf = (text: string) => Buffer.from(text).toString('base64url');
  const goodCursor = cursorOf(`1700000000000:${randomUUID()}`);

  it('accepts a well-formed cursor', async () => {
    const res = await get(build(), owner.cookie, `/classes?cursor=${goodCursor}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['text that is not a cursor', 'nope'],
    ['a cursor with an id that is not a UUID', cursorOf('1700000000000:not-a-uuid')],
    ['a cursor with a time that is not a number', cursorOf(`abc:${randomUUID()}`)],
    ['a cursor with a time that is too large', cursorOf(`99999999999999999:${randomUUID()}`)],
    ['a cursor with a leading zero in the time', cursorOf(`01700000000000:${randomUUID()}`)],
    ['a cursor with an extra part', cursorOf(`1700000000000:${randomUUID()}:extra`)],
    ['a cursor with a stray character', `${goodCursor}*`],
  ])('refuses %s', async (_label, cursor) => {
    const res = await get(build(), owner.cookie, `/classes?cursor=${cursor}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields).toHaveProperty(['query.cursor']);
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc', '?limit=0x10', '?status=DELETED', '?unknown=1'])(
    'refuses the query %s',
    async (query) => {
      const res = await get(build(), owner.cookie, `/classes${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    },
  );

  it('needs a session', async () => {
    const res = await request(build()).get('/api/classes');
    expect(res.status).toBe(401);
  });

  it.each(['', '?limit=abc', '?unknown=1'])('is NOT_FOUND for a student, whatever they send (%j)', async (query) => {
    const res = await get(build(), student.cookie, `/classes${query}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('get one class (API Spec CLS-03)', () => {
  it('returns the class, with its code, link and student counts, to the instructor who owns it', async () => {
    const made = await create(build(), owner.cookie, validBody({ name: 'Physics' }));

    const res = await get(build(), owner.cookie, `/classes/${made.body.id}`);

    expect(res.status).toBe(200);
    const counts = { approved: 0, pending: 0, declined: 0, removed: 0 }; // the counts come with the class, not with creating it
    expect(ClassSummarySchema.parse(res.body)).toEqual({ ...ClassSummarySchema.parse(made.body), counts });
  });

  it('still shows an archived class to its owner', async () => {
    const archived = await seed(owner.user.id, { archivedAt: new Date() });
    const res = await get(build(), owner.cookie, `/classes/${archived.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ARCHIVED');
  });

  it('is NOT_FOUND for another instructor, a student, and an id that does not exist, so they look the same', async () => {
    const mine = await seed(owner.user.id);
    const answers = [
      await get(build(), other.cookie, `/classes/${mine.id}`),
      await get(build(), student.cookie, `/classes/${mine.id}`),
      await get(build(), owner.cookie, `/classes/${randomUUID()}`),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  // Students use this route too (below), so it has no role check, and a student gets the same answers as an instructor.
  it.each([
    ['an instructor', () => owner.cookie],
    ['a student', () => student.cookie],
  ])('refuses an id that is not a UUID, for %s', async (_who, cookie) => {
    const res = await get(build(), cookie(), '/classes/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty(['params.classId']);
  });

  it('refuses a query parameter, since this route takes none (API Spec A2)', async () => {
    const mine = await seed(owner.user.id);
    const res = await get(build(), owner.cookie, `/classes/${mine.id}?foo=1`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('needs a session', async () => {
    const mine = await seed(owner.user.id);
    const res = await request(build()).get(`/api/classes/${mine.id}`);
    expect(res.status).toBe(401);
  });
});

/** A student of their own, already in a class in the given state. */
async function enrolled(name: string, classId: string, status: EnrollmentStatus, joinedAt?: Date) {
  const who = await signedInUser(name, 'STUDENT');
  await db.enrollment.create({ data: { classId, studentId: who.user.id, status, joinedAt } });
  return who;
}

describe('a student views a class (API Spec CLS-03)', () => {
  it('gives an approved student the details and the instructor name, and no join code, link or counts', async () => {
    const klass = await seed(owner.user.id, { name: 'Chemistry', description: 'Atoms', section: 'B' });
    const { cookie } = await enrolled('view-active', klass.id, 'ACTIVE');

    const res = await get(build(), cookie, `/classes/${klass.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: klass.id,
      name: 'Chemistry',
      description: 'Atoms',
      section: 'B',
      subject: null,
      room: null,
      status: 'ACTIVE',
      instructorName: 'Ada L.', // first name and last initial only
      enrollment: { status: 'ACTIVE' },
    });
  });

  it('shows an archived class to an approved student, marked archived', async () => {
    const klass = await seed(owner.user.id, { archivedAt: new Date() });
    const { cookie } = await enrolled('view-archived', klass.id, 'ACTIVE');

    expect((await get(build(), cookie, `/classes/${klass.id}`)).body.status).toBe('ARCHIVED');
  });

  it('tells a pending student the class name and nothing else (ENROLLMENT_PENDING)', async () => {
    const klass = await seed(owner.user.id, { name: 'Secret club', description: 'Not for pending eyes' });
    const { cookie } = await enrolled('view-pending', klass.id, 'PENDING');

    const res = await get(build(), cookie, `/classes/${klass.id}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ENROLLMENT_PENDING');
    expect(res.body.error.details).toEqual({ className: 'Secret club' });
    expect(JSON.stringify(res.body)).not.toContain('Not for pending eyes');
  });

  it.each(['DECLINED', 'REMOVED'] as const)('is NOT_FOUND for a %s student, as for a stranger', async (status) => {
    const klass = await seed(owner.user.id);
    const { cookie } = await enrolled(`view-${status.toLowerCase()}`, klass.id, status);

    const res = await get(build(), cookie, `/classes/${klass.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('is NOT_FOUND for an approved student of a different class', async () => {
    const mine = await seed(owner.user.id);
    const theirs = await seed(owner.user.id);
    const { cookie } = await enrolled('view-elsewhere', theirs.id, 'ACTIVE');

    expect((await get(build(), cookie, `/classes/${mine.id}`)).status).toBe(404);
  });
});

describe('a student lists their classes (API Spec JOIN-03)', () => {
  const list = (cookie: string, query = '') => get(build(), cookie, `/me/enrollments${query}`);
  const ids = (body: { items: { classId: string }[] }) => body.items.map((item) => item.classId);

  it('lists their own classes with every status but removed, newest joined first', async () => {
    const base = Date.now() - 60_000;
    const [a, b, c, d, e] = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name, i) =>
        seed(owner.user.id, { name: `Enrolled ${name}`, archivedAt: i === 4 ? new Date() : null }),
      ),
    );
    const me = await enrolled('list-me', a!.id, 'ACTIVE', new Date(base));
    const join = (klass: typeof a, status: EnrollmentStatus, seconds: number) =>
      db.enrollment.create({ data: { classId: klass!.id, studentId: me.user.id, status, joinedAt: new Date(base + seconds * 1000) } });
    await join(b, 'PENDING', 1);
    await join(c, 'DECLINED', 2);
    await join(d, 'REMOVED', 3);
    await join(e, 'ACTIVE', 4);
    await enrolled('list-someone-else', a!.id, 'ACTIVE'); // another student's enrollment never shows

    const res = await list(me.cookie);

    expect(res.status).toBe(200);
    expect(EnrolledPageSchema.parse(res.body).items).toEqual([
      { classId: e!.id, className: 'Enrolled E', status: 'ACTIVE', instructorName: 'Ada L.', archived: true, joinedAt: new Date(base + 4000).toISOString() },
      { classId: c!.id, className: 'Enrolled C', status: 'DECLINED', instructorName: 'Ada L.', archived: false, joinedAt: new Date(base + 2000).toISOString() },
      { classId: b!.id, className: 'Enrolled B', status: 'PENDING', instructorName: 'Ada L.', archived: false, joinedAt: new Date(base + 1000).toISOString() },
      { classId: a!.id, className: 'Enrolled A', status: 'ACTIVE', instructorName: 'Ada L.', archived: false, joinedAt: new Date(base).toISOString() },
    ]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('is an empty list for a student who has joined nothing', async () => {
    const { cookie } = await signedInUser('list-none', 'STUDENT');

    expect((await list(cookie)).body).toEqual({ items: [], nextCursor: null });
  });

  it('pages with a cursor', async () => {
    const base = Date.now() - 60_000;
    const classes = await Promise.all([1, 2, 3].map(() => seed(owner.user.id)));
    const me = await signedInUser('list-pages', 'STUDENT');
    for (const [i, klass] of classes.entries()) {
      await db.enrollment.create({ data: { classId: klass.id, studentId: me.user.id, status: 'ACTIVE', joinedAt: new Date(base + i * 1000) } });
    }

    const first = await list(me.cookie, '?limit=2');
    const second = await list(me.cookie, `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);

    expect(ids(first.body)).toEqual([classes[2]!.id, classes[1]!.id]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(ids(second.body)).toEqual([classes[0]!.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each(['?limit=0', '?limit=101', '?cursor=nonsense', '?foo=1'])('refuses the query %s', async (query) => {
    const res = await list(student.cookie, query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('is NOT_FOUND for an instructor, whatever they send, and needs a session', async () => {
    expect((await list(owner.cookie)).status).toBe(404);
    expect((await list(owner.cookie, '?limit=abc')).status).toBe(404);
    expect((await request(build()).get('/api/me/enrollments')).status).toBe(401);
  });
});

describe('archive and restore a class (API Spec CLS-05, CLS-06)', () => {
  const post = (cookie: string | undefined, classId: string, action: 'archive' | 'restore') => {
    const req = request(build()).post(`/api/classes/${classId}/${action}`).set('Origin', APP_URL);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const stored = (classId: string) => db.class.findUniqueOrThrow({ where: { id: classId } });
  const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

  it('archives the class and keeps its code and link; the class leaves the default list and shows when archived classes are asked for', async () => {
    const { user, cookie } = await signedInUser('archive-owner', 'INSTRUCTOR');
    const klass = await seed(user.id);

    const res = await post(cookie, klass.id, 'archive');

    expect(res.status).toBe(200);
    expect(ClassSummarySchema.parse(res.body)).toMatchObject({ id: klass.id, status: 'ARCHIVED', joinCode: klass.joinCode });
    expect((await stored(klass.id)).archivedAt).not.toBeNull();
    const active = ClassPageSchema.parse((await get(build(), cookie, '/classes')).body);
    const archived = ClassPageSchema.parse((await get(build(), cookie, '/classes?status=ARCHIVED')).body);
    expect(active.items).toEqual([]);
    expect(archived.items.map((c) => c.id)).toEqual([klass.id]);
  });

  it('archiving an archived class changes nothing, so the archive date does not move', async () => {
    const klass = await seed(owner.user.id, { archivedAt: LONG_AGO });

    const res = await post(owner.cookie, klass.id, 'archive');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ARCHIVED');
    expect((await stored(klass.id)).archivedAt).toEqual(LONG_AGO);
  });

  it('restores the class, and clears the retention notice with the archive date', async () => {
    const noticeAt = new Date('2026-12-01T00:00:00.000Z');
    const klass = await seed(owner.user.id, { archivedAt: LONG_AGO, retentionNoticeAt: noticeAt });

    const res = await post(owner.cookie, klass.id, 'restore');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(await stored(klass.id)).toMatchObject({ archivedAt: null, retentionNoticeAt: null });
  });

  it('restoring an active class changes nothing', async () => {
    const klass = await seed(owner.user.id);

    const res = await post(owner.cookie, klass.id, 'restore');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect((await stored(klass.id)).archivedAt).toBeNull();
  });

  it('stops the join code while archived and brings it back on restore', async () => {
    const klass = await seed(owner.user.id);
    const join = async (cookie: string) =>
      request(build()).post('/api/join').set('Origin', APP_URL).set('Cookie', cookie).send({ code: klass.joinCode });
    const first = await signedInUser('archive-join-1', 'STUDENT');
    const second = await signedInUser('archive-join-2', 'STUDENT');

    await post(owner.cookie, klass.id, 'archive');
    const whileArchived = await join(first.cookie);
    await post(owner.cookie, klass.id, 'restore');
    const afterRestore = await join(second.cookie);

    expect(whileArchived.status).toBe(404);
    expect(whileArchived.body.error.code).toBe('INVALID_JOIN_CODE');
    expect(afterRestore.status).toBe(201);
  });

  it('keeps an approved student in the class, read-only, and in their Enrolled list marked archived', async () => {
    const klass = await seed(owner.user.id);
    const { cookie } = await enrolled('archive-student', klass.id, 'ACTIVE');

    await post(owner.cookie, klass.id, 'archive');

    expect((await get(build(), cookie, `/classes/${klass.id}`)).body.status).toBe('ARCHIVED');
    const list = EnrolledPageSchema.parse((await get(build(), cookie, '/me/enrollments')).body);
    expect(list.items).toMatchObject([{ classId: klass.id, status: 'ACTIVE', archived: true }]);
  });

  it.each(['archive', 'restore'] as const)('is NOT_FOUND to another instructor, a student and a missing class on %s, and changes nothing', async (action) => {
    const klass = await seed(owner.user.id, action === 'restore' ? { archivedAt: LONG_AGO } : {});
    const before = (await stored(klass.id)).archivedAt;

    const answers = [
      await post(other.cookie, klass.id, action),
      await post(student.cookie, klass.id, action),
      await post(owner.cookie, randomUUID(), action),
    ];

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await stored(klass.id)).archivedAt).toEqual(before);
  });

  it.each(['archive', 'restore'] as const)('needs a session and a class id on %s', async (action) => {
    const klass = await seed(owner.user.id);

    expect((await post(undefined, klass.id, action)).status).toBe(401);
    const bad = await post(owner.cookie, 'not-an-id', action);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });
});

describe('edit class details (API Spec CLS-04)', () => {
  const patch = (cookie: string | undefined, classId: string, body: object) => {
    const req = request(build()).patch(`/api/classes/${classId}`).set('Origin', APP_URL);
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const stored = (classId: string) => db.class.findUniqueOrThrow({ where: { id: classId } });
  const full = { description: 'Cells', section: 'B', subject: 'Biology', room: '4' };

  it('changes only the fields sent, and leaves the code, the link and the students alone', async () => {
    const klass = await seed(owner.user.id, { name: 'Biology 101', ...full, requireApproval: true });
    await enrolled('edit-member', klass.id, 'ACTIVE');

    const res = await patch(owner.cookie, klass.id, { name: '  Biology 102 ', room: '9' });

    expect(res.status).toBe(200);
    expect(ClassSummarySchema.parse(res.body)).toMatchObject({
      id: klass.id,
      name: 'Biology 102',
      description: 'Cells',
      section: 'B',
      subject: 'Biology',
      room: '9',
      status: 'ACTIVE',
      joinCode: klass.joinCode,
      joinLink: `${APP_URL}/join/${klass.joinCode}`,
      requireApproval: true,
    });
    expect(await stored(klass.id)).toMatchObject({ name: 'Biology 102', room: '9', joinCode: klass.joinCode, requireApproval: true });
    expect(await db.enrollment.count({ where: { classId: klass.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('clears an optional field that is sent blank, and never the name', async () => {
    const klass = await seed(owner.user.id, { name: 'Biology 101', ...full });

    const res = await patch(owner.cookie, klass.id, { description: '', section: '   ', subject: '' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Biology 101', description: null, section: null, subject: null, room: '4' });
    expect(await stored(klass.id)).toMatchObject({ description: null, section: null, subject: null, room: '4' });
  });

  it('changes nothing for an empty body', async () => {
    const klass = await seed(owner.user.id, { name: 'Biology 101', ...full });

    const res = await patch(owner.cookie, klass.id, {});

    expect(res.status).toBe(200);
    expect(await stored(klass.id)).toMatchObject({ name: 'Biology 101', ...full });
  });

  it.each([
    ['a blank name', { name: '   ' }, 'name'],
    ['a name over 120 characters', { name: 'a'.repeat(121) }, 'name'],
    ['a room over 60 characters', { room: 'a'.repeat(61) }, 'room'],
    ['a NUL character', { section: 'a\u0000b' }, 'section'],
    ['the join code', { joinCode: 'ABCDEFGH' }, undefined],
  ])('refuses %s with VALIDATION, and changes nothing', async (_label, body, field) => {
    const klass = await seed(owner.user.id, { name: 'Biology 101', ...full });

    // A valid change is sent along, to show that one bad field stops the whole edit.
    const res = await patch(owner.cookie, klass.id, { ...body, description: 'Changed' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    if (field) expect(res.body.error.fields).toHaveProperty([field]);
    expect(await stored(klass.id)).toMatchObject({ name: 'Biology 101', ...full });
  });

  it('refuses an archived class with CLASS_ARCHIVED, and changes nothing', async () => {
    const klass = await seed(owner.user.id, { name: 'Biology 101', archivedAt: new Date() });

    const res = await patch(owner.cookie, klass.id, { name: 'Changed' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    expect((await stored(klass.id)).name).toBe('Biology 101');
  });

  it('is NOT_FOUND to another instructor, a student and a missing class, and changes nothing', async () => {
    const klass = await seed(owner.user.id, { name: 'Biology 101' });

    const answers = [
      await patch(other.cookie, klass.id, { name: 'Changed' }),
      await patch(student.cookie, klass.id, { name: 'Changed' }),
      await patch(owner.cookie, randomUUID(), { name: 'Changed' }),
    ];

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await stored(klass.id)).name).toBe('Biology 101');
  });

  it('needs a session and a class id', async () => {
    const klass = await seed(owner.user.id);

    expect((await patch(undefined, klass.id, { name: 'Changed' })).status).toBe(401);
    const bad = await patch(owner.cookie, 'not-an-id', { name: 'Changed' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });
});

describe('join a class by code (API Spec JOIN-01)', () => {
  const join = (app: TestApp, cookie: string, code: unknown) =>
    request(app).post('/api/join').set('Origin', APP_URL).set('Cookie', cookie).send({ code });
  const enrollments = (classId: string) => db.enrollment.findMany({ where: { classId } });
  const NO_SUCH_CODE = '22222222';

  it('adds the student at once when approval is off (201 ACTIVE)', async () => {
    const klass = await seed(owner.user.id);
    const { user, cookie } = await signedInUser('join-open', 'STUDENT');

    const res = await join(build(), cookie, klass.joinCode);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ classId: klass.id, className: klass.name, status: 'ACTIVE' });
    expect(await enrollments(klass.id)).toMatchObject([{ studentId: user.id, status: 'ACTIVE' }]);
  });

  it('makes the student Pending when approval is on (201 PENDING)', async () => {
    const klass = await seed(owner.user.id, { requireApproval: true });
    const { cookie } = await signedInUser('join-approval', 'STUDENT');

    const res = await join(build(), cookie, klass.joinCode);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  it('accepts the code in lower case with spaces around it', async () => {
    const klass = await seed(owner.user.id);
    const { cookie } = await signedInUser('join-lower', 'STUDENT');

    const res = await join(build(), cookie, `  ${klass.joinCode.toLowerCase()} `);

    expect(res.status).toBe(201);
    expect(res.body.classId).toBe(klass.id);
  });

  it('does nothing new the second time (200, one row)', async () => {
    const klass = await seed(owner.user.id);
    const { cookie } = await signedInUser('join-twice', 'STUDENT');
    const app = build();

    const first = await join(app, cookie, klass.joinCode);
    const second = await join(app, cookie, klass.joinCode);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await enrollments(klass.id)).toHaveLength(1);
  });

  it.each(['PENDING', 'DECLINED'] as const)('keeps a %s student as they are (200)', async (status) => {
    const klass = await seed(owner.user.id, { requireApproval: true });
    const { user, cookie } = await signedInUser(`join-${status.toLowerCase()}`, 'STUDENT');
    await db.enrollment.create({ data: { classId: klass.id, studentId: user.id, status } });

    const res = await join(build(), cookie, klass.joinCode);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
  });

  it('refuses a removed student with JOIN_BLOCKED and leaves them removed', async () => {
    const klass = await seed(owner.user.id);
    const { user, cookie } = await signedInUser('join-removed', 'STUDENT');
    await db.enrollment.create({ data: { classId: klass.id, studentId: user.id, status: 'REMOVED' } });

    const res = await join(build(), cookie, klass.joinCode);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('JOIN_BLOCKED');
    expect(await enrollments(klass.id)).toMatchObject([{ status: 'REMOVED' }]);
  });

  it('gives the same INVALID_JOIN_CODE for an unknown, switched-off and archived code', async () => {
    const off = await seed(owner.user.id, { joinCodeActive: false });
    const archived = await seed(owner.user.id, { archivedAt: new Date() });
    const { cookie } = await signedInUser('join-invalid', 'STUDENT');
    const app = build();

    const answers = [
      await join(app, cookie, NO_SUCH_CODE),
      await join(app, cookie, off.joinCode),
      await join(app, cookie, archived.joinCode),
    ];

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVALID_JOIN_CODE');
    }
    expect(new Set(answers.map((res) => res.body.error.message)).size).toBe(1);
    expect(await enrollments(off.id)).toHaveLength(0);
    expect(await enrollments(archived.id)).toHaveLength(0);
  });

  it('tells an instructor that instructor accounts cannot join (403)', async () => {
    const klass = await seed(owner.user.id);

    const res = await join(build(), other.cookie, klass.joinCode);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTRUCTOR_CANNOT_JOIN');
  });

  it('needs a session', async () => {
    const res = await request(build()).post('/api/join').set('Origin', APP_URL).send({ code: NO_SUCH_CODE });
    expect(res.status).toBe(401);
  });

  it.each([['no code', undefined], ['a code that is too short', 'ABC'], ['a code that is too long', 'ABCDEFGHJ'], ['a blank code', '   ']])(
    'refuses %s',
    async (_label, code) => {
      const res = await join(build(), student.cookie, code);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.fields).toHaveProperty(['code']);
    },
  );

  it('keeps one row when the same student joins twice at the same moment', async () => {
    const klass = await seed(owner.user.id);
    const { cookie } = await signedInUser('join-race', 'STUDENT');
    const app = build();

    const answers = await Promise.all([join(app, cookie, klass.joinCode), join(app, cookie, klass.joinCode)]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(await enrollments(klass.id)).toHaveLength(1);
  });

  it('allows 10 failed attempts an hour per student, then RATE_LIMITED; joins and malformed codes are not counted', async () => {
    const klass = await seed(owner.user.id);
    const { cookie } = await signedInUser('join-rate', 'STUDENT');
    const app = build();

    expect((await join(app, cookie, klass.joinCode)).status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await join(app, cookie, 'ABC')).status).toBe(400);
    for (let i = 0; i < RULES.joinByUser.limit; i++) expect((await join(app, cookie, NO_SUCH_CODE)).status).toBe(404);
    const res = await join(app, cookie, NO_SUCH_CODE);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('preview a join link (API Spec JOIN-02)', () => {
  const preview = (app: TestApp, code: string, cookie?: string) => {
    const req = request(app).get(`/api/join/${code}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const NO_SUCH_CODE = '22222222';

  it('shows the class name, the instructor\'s first name and the approval setting to someone signed out, and nothing else', async () => {
    const klass = await seed(owner.user.id, { name: 'Chemistry', requireApproval: true });

    const res = await preview(build(), klass.joinCode);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ className: 'Chemistry', instructorFirstName: 'Ada', requireApproval: true });
  });

  it('works the same for a signed-in student, in lower case with spaces around the code', async () => {
    const klass = await seed(owner.user.id, { name: 'Physics' });

    const res = await preview(build(), `%20${klass.joinCode.toLowerCase()}%20`, student.cookie);

    expect(res.status).toBe(200);
    expect(res.body.className).toBe('Physics');
  });

  it('joins no one: it creates no enrollment', async () => {
    const klass = await seed(owner.user.id);
    await preview(build(), klass.joinCode, student.cookie);
    expect(await db.enrollment.count({ where: { classId: klass.id } })).toBe(0);
  });

  it('gives the same INVALID_JOIN_CODE for an unknown, switched-off, archived and wrongly sized code', async () => {
    const off = await seed(owner.user.id, { joinCodeActive: false });
    const archived = await seed(owner.user.id, { archivedAt: new Date() });
    const app = build();

    const answers = [NO_SUCH_CODE, off.joinCode, archived.joinCode, 'ABC', 'ABCDEFGHJKLM'].map((code) => preview(app, code));

    const results = await Promise.all(answers);
    for (const res of results) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVALID_JOIN_CODE');
    }
    expect(new Set(results.map((res) => res.body.error.message)).size).toBe(1);
  });

  it('tells a signed-in instructor that instructor accounts cannot join (403)', async () => {
    const klass = await seed(owner.user.id);

    const res = await preview(build(), klass.joinCode, other.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSTRUCTOR_CANNOT_JOIN');
  });

  it('ignores an expired or made-up session and answers as for a signed-out visitor', async () => {
    const klass = await seed(owner.user.id);
    const res = await preview(build(), klass.joinCode, `${SESSION_COOKIE}=not-a-session`);
    expect(res.status).toBe(200);
  });

  it('allows 30 failed tries an hour per IP, then RATE_LIMITED; good codes are not counted', async () => {
    const klass = await seed(owner.user.id);
    const app = build();

    for (let i = 0; i < 5; i++) expect((await preview(app, klass.joinCode)).status).toBe(200);
    for (let i = 0; i < RULES.joinPreviewByIp.limit; i++) expect((await preview(app, NO_SUCH_CODE)).status).toBe(404);
    const refused = await preview(app, NO_SUCH_CODE);

    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('rate limits on the real routes (API Spec A12)', () => {
  // The RateLimit-Limit header names the limit that answered, so this proves the right limiter is mounted on each route
  // without sending 120 requests.
  it('creating a class has its own limit; reading classes and /me use the general one', async () => {
    const app = build();

    const made = await create(app, owner.cookie, validBody());
    expect(made.headers['ratelimit-limit']).toBe('20');
    expect((await get(app, owner.cookie, '/classes')).headers['ratelimit-limit']).toBe('120');
    expect((await get(app, owner.cookie, `/classes/${made.body.id}`)).headers['ratelimit-limit']).toBe('120');
    expect((await get(app, owner.cookie, '/me')).headers['ratelimit-limit']).toBe('120');
  });

  it('gives each user ONE budget of 120 a minute across all the routes that use the general limit', async () => {
    const { cookie } = await signedInUser('budget', 'INSTRUCTOR');
    const app = build();

    // 121 requests spread over two routes, sent together. If each route had its own counter, none would be refused.
    const paths = Array.from({ length: RULES.everythingElseByUser.limit + 1 }, (_, i) => (i % 2 === 0 ? '/me' : '/classes'));
    const statuses = (await Promise.all(paths.map((path) => get(app, cookie, path)))).map((res) => res.status);

    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(RULES.everythingElseByUser.limit);

    // Another user on the same app has a budget of their own.
    expect((await get(app, owner.cookie, '/me')).status).toBe(200);
  });

  it('does not count the join-link preview against that general limit, so a class can open one link together', async () => {
    const klass = await seed(owner.user.id);
    const app = build();

    // More requests than the general limit allows, all from one IP and signed out, like a class on one school network.
    // Ten at a time: the failed-only limit gives a good request back only once it has been answered, so the requests are
    // not sent all in the same instant.
    const statuses: number[] = [];
    for (let batch = 0; batch < 13; batch++) {
      const answers = await Promise.all(Array.from({ length: 10 }, () => request(app).get(`/api/join/${klass.joinCode}`)));
      statuses.push(...answers.map((res) => res.status));
    }

    expect(statuses.length).toBeGreaterThan(RULES.everythingElseByUser.limit);
    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
