import type * as NodeCrypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClassPageSchema, ClassSummarySchema, TERMS_VERSION, type CreateClass, type Role } from '@edugemini/shared';
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
  it('returns the class, with its code and link, to the instructor who owns it', async () => {
    const made = await create(build(), owner.cookie, validBody({ name: 'Physics' }));

    const res = await get(build(), owner.cookie, `/classes/${made.body.id}`);

    expect(res.status).toBe(200);
    expect(ClassSummarySchema.parse(res.body)).toEqual(ClassSummarySchema.parse(made.body));
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

  it('is NOT_FOUND for a student even when the id is not a UUID, so the route does not reveal itself', async () => {
    const res = await get(build(), student.cookie, '/classes/not-an-id');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses an id that is not a UUID', async () => {
    const res = await get(build(), owner.cookie, '/classes/not-an-id');
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
});
