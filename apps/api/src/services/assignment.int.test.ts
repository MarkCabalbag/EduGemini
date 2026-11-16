import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssignmentDetailSchema,
  AssignmentPageSchema,
  PublishedAssignmentSchema,
  TERMS_VERSION,
  type Role,
} from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const DAY_MS = 24 * 60 * 60 * 1000;

const db = createTestDb();

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () => createApp({ env: { APP_URL }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });
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

let seeded = 0;
const seedClass = (instructorId: string, overrides: Partial<Prisma.ClassUncheckedCreateInput> = {}) =>
  db.class.create({
    data: { instructorId, name: `Seeded ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date(), ...overrides },
  });

/** An assignment made straight in the database, so a test controls its state and dates. */
const seedAssignment = (classId: string, overrides: Partial<Prisma.AssignmentUncheckedCreateInput> = {}) =>
  db.assignment.create({
    data: {
      classId,
      title: `Seeded assignment ${++seeded}`,
      criteriaText: 'Thesis is clear (10 points).',
      dueAt: new Date(Date.now() + 7 * DAY_MS),
      timezone: 'UTC',
      scoringFormat: 'POINTS',
      maxScore: 100,
      maxResubmissions: 3,
      ...overrides,
    },
  });

const send = (app: TestApp, method: 'post' | 'patch', path: string, cookie: string, body: object = {}) =>
  request(app)[method](`/api${path}`).set('Origin', APP_URL).set('Cookie', cookie).send(body);
const get = (app: TestApp, path: string, cookie: string) => request(app).get(`/api${path}`).set('Cookie', cookie);

let owner: Awaited<ReturnType<typeof signedInUser>>;
let other: typeof owner;
let student: typeof owner;
let cls: Awaited<ReturnType<typeof seedClass>>;

beforeAll(async () => {
  await db.$connect();
  owner = await signedInUser('owner', 'INSTRUCTOR');
  other = await signedInUser('other', 'INSTRUCTOR');
  student = await signedInUser('student', 'STUDENT');
  cls = await seedClass(owner.user.id);
});

afterAll(async () => {
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // assignments go with the class
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } }); // sessions and keys cascade
  await db.$disconnect();
});

describe('create assignment (API Spec ASG-02)', () => {
  const create = (cookie: string, body: object, classId = cls.id) => send(build(), 'post', `/classes/${classId}/assignments`, cookie, body);

  it('makes a draft from a title alone, with the defaults', async () => {
    const res = await create(owner.cookie, { title: '  Essay 2 ' });

    expect(res.status).toBe(201);
    const body = AssignmentDetailSchema.parse(res.body);
    expect(body).toMatchObject({
      classId: cls.id,
      title: 'Essay 2',
      status: 'DRAFT',
      instructions: null,
      criteriaText: '',
      timezone: 'UTC',
      scoringFormat: 'POINTS',
      maxScore: 100,
      maxResubmissions: 3,
      acceptLate: true,
      criteriaVersion: 1,
    });
    // The due date is a placeholder, a week ahead, until the instructor sets one.
    expect(Math.abs(new Date(body.dueAt).getTime() - (Date.now() + 7 * DAY_MS))).toBeLessThan(60_000);
    const row = await db.assignment.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.classId).toBe(cls.id);
    expect(row.publishedAt).toBeNull();
  });

  it('stores every field it is given, and a blank instructions field as null', async () => {
    const dueAt = '2026-12-01T15:59:00.000Z';
    const res = await create(owner.cookie, {
      title: 'Lab report',
      instructions: '   ',
      criteriaText: 'Method is clear.',
      dueAt,
      timezone: 'Asia/Manila',
      maxScore: 50,
      maxResubmissions: 0,
      acceptLate: false,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      instructions: null,
      criteriaText: 'Method is clear.',
      dueAt,
      timezone: 'Asia/Manila',
      scoringFormat: 'POINTS',
      maxScore: 50,
      maxResubmissions: 0,
      acceptLate: false,
    });
  });

  it('keeps null as Unlimited resubmissions, not as the default of 3', async () => {
    const res = await create(owner.cookie, { title: 'Quiz', maxResubmissions: null });
    expect(res.body.maxResubmissions).toBeNull();
  });

  it.each(['PERCENTAGE', 'LETTER_NUMERIC'])('makes a %s assignment out of 100 whatever max score is sent', async (scoringFormat) => {
    const res = await create(owner.cookie, { title: 'Quiz', scoringFormat, maxScore: 50 });
    expect(res.body).toMatchObject({ scoringFormat, maxScore: 100 });
  });

  it.each([
    ['no title', {}, 'title'],
    ['a blank title', { title: '   ' }, 'title'],
    ['a title over 200 characters', { title: 'x'.repeat(201) }, 'title'],
    ['instructions with a NUL character', { title: 'A', instructions: 'a\u0000b' }, 'instructions'],
    ['criteria over 5000 characters', { title: 'A', criteriaText: 'x'.repeat(5001) }, 'criteriaText'],
    ['a time zone that does not exist', { title: 'A', timezone: 'Mars/Olympus' }, 'timezone'],
    ['a due date that is not a timestamp', { title: 'A', dueAt: 'next Friday' }, 'dueAt'],
    ['an unknown scoring format', { title: 'A', scoringFormat: 'STARS' }, 'scoringFormat'],
    ['a max score of 0', { title: 'A', maxScore: 0 }, 'maxScore'],
    ['a max score over 1000', { title: 'A', maxScore: 1001 }, 'maxScore'],
    ['11 resubmissions', { title: 'A', maxResubmissions: 11 }, 'maxResubmissions'],
  ])('refuses %s', async (_label, body, field) => {
    const res = await create(owner.cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields).toHaveProperty([field]);
  });

  it('needs a session', async () => {
    const res = await request(build()).post(`/api/classes/${cls.id}/assignments`).set('Origin', APP_URL).send({ title: 'A' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['a student', () => student.cookie, () => cls.id],
    ['another instructor', () => other.cookie, () => cls.id],
    ['the owner, for a class that does not exist', () => owner.cookie, () => randomUUID()],
  ])('gives %s NOT_FOUND and creates nothing', async (_label, cookie, classId) => {
    const before = await db.assignment.count({ where: { classId: cls.id } });
    const res = await create(cookie(), { title: 'A' }, classId());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await db.assignment.count({ where: { classId: cls.id } })).toBe(before);
  });

  it('is refused on an archived class, which is read-only', async () => {
    const archived = await seedClass(owner.user.id, { archivedAt: new Date() });
    const res = await create(owner.cookie, { title: 'A' }, archived.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    expect(await db.assignment.count({ where: { classId: archived.id } })).toBe(0);
  });
});

describe('get assignment (API Spec ASG-03)', () => {
  it("gives the owning instructor the assignment's details", async () => {
    const row = await seedAssignment(cls.id, { instructions: 'Write 500 words.' });
    const res = await get(build(), `/assignments/${row.id}`, owner.cookie);

    expect(res.status).toBe(200);
    expect(AssignmentDetailSchema.parse(res.body)).toMatchObject({
      id: row.id,
      title: row.title,
      instructions: 'Write 500 words.',
      criteriaText: 'Thesis is clear (10 points).',
      status: 'DRAFT',
    });
  });

  it.each([
    ['a student', () => student.cookie],
    ['another instructor', () => other.cookie],
  ])('gives %s NOT_FOUND', async (_label, cookie) => {
    const row = await seedAssignment(cls.id);
    const res = await get(build(), `/assignments/${row.id}`, cookie());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('gives NOT_FOUND for an assignment that does not exist and VALIDATION for an address that is not an id', async () => {
    expect((await get(build(), `/assignments/${randomUUID()}`, owner.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await get(build(), '/assignments/not-an-id', owner.cookie)).body.error.code).toBe('VALIDATION');
  });
});

describe('list assignments (API Spec ASG-01)', () => {
  const list = (cookie: string, classId: string, query = '') => get(build(), `/classes/${classId}/assignments${query}`, cookie);

  it('lists the class by nearest due date, drafts included, and leaves other classes out', async () => {
    const mine = await seedClass(owner.user.id);
    const later = await seedAssignment(mine.id, { dueAt: new Date('2027-03-01T00:00:00Z') });
    const sooner = await seedAssignment(mine.id, { dueAt: new Date('2027-01-01T00:00:00Z'), status: 'PUBLISHED', publishedAt: new Date() });
    await seedAssignment((await seedClass(owner.user.id)).id); // another class

    const res = await list(owner.cookie, mine.id);

    expect(res.status).toBe(200);
    const page = AssignmentPageSchema.parse(res.body);
    expect(page.items.map((item) => item.id)).toEqual([sooner.id, later.id]);
    expect(page.items.map((item) => item.status)).toEqual(['PUBLISHED', 'DRAFT']);
    expect(page.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    const mine = await seedClass(owner.user.id);
    const draft = await seedAssignment(mine.id);
    await seedAssignment(mine.id, { status: 'PUBLISHED', publishedAt: new Date() });

    const res = await list(owner.cookie, mine.id, '?status=DRAFT');

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([draft.id]);
  });

  it('pages through the list in order, even when two share a due date', async () => {
    const mine = await seedClass(owner.user.id);
    const sameDay = new Date('2027-02-01T00:00:00Z');
    const rows = [
      await seedAssignment(mine.id, { dueAt: sameDay }),
      await seedAssignment(mine.id, { dueAt: sameDay }),
      await seedAssignment(mine.id, { dueAt: new Date('2027-04-01T00:00:00Z') }),
    ];
    const expected = [...rows].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || (a.id < b.id ? -1 : 1)).map((row) => row.id);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await list(owner.cookie, mine.id, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.body.items).toHaveLength(1);
      seen.push(res.body.items[0].id);
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toEqual(expected);
  });

  it.each(['?status=DELETED', '?cursor=nonsense', '?colour=red'])('refuses the query %s', async (query) => {
    const res = await list(owner.cookie, cls.id, query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it.each([
    ['a student', () => student.cookie],
    ['another instructor', () => other.cookie],
  ])('gives %s NOT_FOUND', async (_label, cookie) => {
    const res = await list(cookie(), cls.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('edit a draft (API Spec ASG-04)', () => {
  const patch = (cookie: string, id: string, body: object) => send(build(), 'patch', `/assignments/${id}`, cookie, body);

  it('changes only the fields it is given', async () => {
    const row = await seedAssignment(cls.id, { instructions: 'Old.' });
    const res = await patch(owner.cookie, row.id, {
      title: 'New title',
      criteriaText: 'New criteria.',
      dueAt: '2027-05-01T10:00:00.000Z',
      timezone: 'America/New_York',
      maxScore: 40,
      maxResubmissions: null,
      acceptLate: false,
    });

    expect(res.status).toBe(200);
    expect(AssignmentDetailSchema.parse(res.body)).toMatchObject({
      title: 'New title',
      instructions: 'Old.', // not sent, so not changed
      criteriaText: 'New criteria.',
      dueAt: '2027-05-01T10:00:00.000Z',
      timezone: 'America/New_York',
      maxScore: 40,
      maxResubmissions: null,
      acceptLate: false,
      status: 'DRAFT',
      criteriaVersion: 1, // a draft has no submissions to re-grade
    });
  });

  it('clears the instructions when they are sent blank', async () => {
    const row = await seedAssignment(cls.id, { instructions: 'Old.' });
    const res = await patch(owner.cookie, row.id, { instructions: '  ' });
    expect(res.body.instructions).toBeNull();
  });

  it('keeps a percentage or letter assignment out of 100, and takes a max score again when the format goes back to points', async () => {
    const row = await seedAssignment(cls.id, { maxScore: 50 });

    const percentage = await patch(owner.cookie, row.id, { scoringFormat: 'PERCENTAGE' });
    expect(percentage.body).toMatchObject({ scoringFormat: 'PERCENTAGE', maxScore: 100 });

    const stillPercentage = await patch(owner.cookie, row.id, { maxScore: 20 });
    expect(stillPercentage.body.maxScore).toBe(100);

    const points = await patch(owner.cookie, row.id, { scoringFormat: 'POINTS', maxScore: 20 });
    expect(points.body).toMatchObject({ scoringFormat: 'POINTS', maxScore: 20 });
  });

  it('changes nothing for an empty body', async () => {
    const row = await seedAssignment(cls.id);
    const res = await patch(owner.cookie, row.id, {});
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(row.title);
  });

  it('refuses a value that is not allowed', async () => {
    const row = await seedAssignment(cls.id);
    const res = await patch(owner.cookie, row.id, { title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty(['title']);
  });

  it('leaves a published assignment alone for now (CONFLICT)', async () => {
    const row = await seedAssignment(cls.id, { status: 'PUBLISHED', publishedAt: new Date() });
    const res = await patch(owner.cookie, row.id, { title: 'Changed' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).title).toBe(row.title);
  });

  it('is refused on an archived class', async () => {
    const archived = await seedClass(owner.user.id, { archivedAt: new Date() });
    const row = await seedAssignment(archived.id);
    const res = await patch(owner.cookie, row.id, { title: 'Changed' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
  });

  it.each([
    ['a student', () => student.cookie],
    ['another instructor', () => other.cookie],
  ])('gives %s NOT_FOUND and changes nothing', async (_label, cookie) => {
    const row = await seedAssignment(cls.id);
    const res = await patch(cookie(), row.id, { title: 'Changed' });

    expect(res.status).toBe(404);
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).title).toBe(row.title);
  });
});

describe('publish an assignment (API Spec ASG-06)', () => {
  const publish = (cookie: string, id: string) => send(build(), 'post', `/assignments/${id}/publish`, cookie);

  it('publishes a draft and says there is no connected key', async () => {
    const row = await seedAssignment(cls.id);
    const res = await publish(owner.cookie, row.id);

    expect(res.status).toBe(200);
    const body = PublishedAssignmentSchema.parse(res.body);
    expect(body).toMatchObject({ id: row.id, status: 'PUBLISHED', warnings: ['NO_VALID_KEY'] });
    const stored = await db.assignment.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('PUBLISHED');
    expect(stored.publishedAt).not.toBeNull();
  });

  it.each(['', '   '])('refuses criteria of %j and stays a draft', async (criteriaText) => {
    const row = await seedAssignment(cls.id, { criteriaText });
    const res = await publish(owner.cookie, row.id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields.criteriaText).toBe('Add grading criteria before publishing');
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DRAFT');
  });

  it('warns about a due date in the past, and still publishes', async () => {
    const row = await seedAssignment(cls.id, { dueAt: new Date(Date.now() - DAY_MS) });
    const res = await publish(owner.cookie, row.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.warnings).toEqual(['DUE_IN_PAST', 'NO_VALID_KEY']);
  });

  it('warns about the key only while there is no connected one', async () => {
    const keyed = await signedInUser('keyed', 'INSTRUCTOR');
    const keyedClass = await seedClass(keyed.user.id);
    const warningsFor = async () => (await publish(keyed.cookie, (await seedAssignment(keyedClass.id)).id)).body.warnings;

    expect(await warningsFor()).toEqual(['NO_VALID_KEY']);

    const key = await db.instructorKey.create({
      data: {
        instructorId: keyed.user.id,
        ciphertext: Buffer.from('x'),
        iv: Buffer.alloc(12), // the database checks these lengths
        authTag: Buffer.alloc(16),
        keyVersion: 1,
        last4: '1234',
        status: 'CONNECTED',
        disclosureAckAt: new Date(),
      },
    });
    expect(await warningsFor()).toEqual([]);

    await db.instructorKey.update({ where: { id: key.id }, data: { status: 'NEEDS_ATTENTION' } });
    expect(await warningsFor()).toEqual(['NO_VALID_KEY']);
  });

  it('publishes once: a second publish answers again and keeps the first date', async () => {
    const row = await seedAssignment(cls.id);
    await publish(owner.cookie, row.id);
    const first = await db.assignment.findUniqueOrThrow({ where: { id: row.id } });

    const again = await publish(owner.cookie, row.id);

    expect(again.status).toBe(200);
    expect(again.body.status).toBe('PUBLISHED');
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).publishedAt).toEqual(first.publishedAt);
  });

  it('does not publish an archived assignment (CONFLICT)', async () => {
    const row = await seedAssignment(cls.id, { status: 'ARCHIVED', publishedAt: new Date() });
    const res = await publish(owner.cookie, row.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('is refused on an archived class', async () => {
    const archived = await seedClass(owner.user.id, { archivedAt: new Date() });
    const row = await seedAssignment(archived.id);
    const res = await publish(owner.cookie, row.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DRAFT');
  });

  it.each([
    ['a student', () => student.cookie],
    ['another instructor', () => other.cookie],
  ])('gives %s NOT_FOUND and publishes nothing', async (_label, cookie) => {
    const row = await seedAssignment(cls.id);
    const res = await publish(cookie(), row.id);

    expect(res.status).toBe(404);
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DRAFT');
  });
});
