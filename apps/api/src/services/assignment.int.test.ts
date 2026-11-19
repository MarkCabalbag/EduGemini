import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssignmentDetailSchema,
  AssignmentPageSchema,
  PublishedAssignmentSchema,
  TERMS_VERSION,
  type EnrollmentStatus,
  type Role,
} from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';
import { getMySubmission } from './submission-service';

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const DAY_MS = 24 * 60 * 60 * 1000;

const db = createTestDb();

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({ env: { APP_URL, STORAGE_BUCKET: 'test-bucket' }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });
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
    ['a student who is not in the class', () => student.cookie],
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
    ['a student who is not in the class', () => student.cookie],
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

  it('leaves an archived assignment alone (CONFLICT)', async () => {
    const row = await seedAssignment(cls.id, { status: 'ARCHIVED', publishedAt: new Date() });
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

describe('edit a published assignment (API Spec ASG-04, EG-ASG-05)', () => {
  const patch = (cookie: string, id: string, body: object) => send(build(), 'patch', `/assignments/${id}`, cookie, body);
  const published = { status: 'PUBLISHED', publishedAt: new Date() } as const;

  /** A student approved in the class, with a submission handed in `minutesAgo` minutes ago. The submission is made straight in the database. */
  async function submitted(
    classId: string,
    assignmentId: string,
    minutesAgo: number,
    overrides: Partial<Prisma.SubmissionUncheckedUpdateInput> = {},
  ) {
    const who = await signedInUser(`submitted-${++seeded}`, 'STUDENT');
    await db.enrollment.create({ data: { classId, studentId: who.user.id, status: 'ACTIVE' } });
    const at = new Date(Date.now() - minutesAgo * 60_000);
    const submission = await db.submission.create({ data: { assignmentId, studentId: who.user.id } });
    const version = await db.submissionVersion.create({
      data: { submissionId: submission.id, versionNo: 1, status: 'STORED', storedAt: at },
    });
    await db.submission.update({
      where: { id: submission.id },
      data: { currentVersionId: version.id, state: 'QUEUED', firstSubmittedAt: at, latestSubmittedAt: at, ...overrides },
    });
    return who;
  }
  // The student's own view (API Spec SUB-01). Its route is wired in `main.ts` with the uploads, so the service is called here.
  const mine = (who: { user: { id: string } }, id: string) => getMySubmission(db, { id: who.user.id, role: 'STUDENT' }, id);

  it('changes the title, instructions, due date, time zone, limit and late policy, and stays published', async () => {
    const row = await seedAssignment(cls.id, published);
    const res = await patch(owner.cookie, row.id, {
      title: 'New title',
      instructions: 'New instructions.',
      dueAt: '2027-05-01T10:00:00.000Z',
      timezone: 'Asia/Manila',
      maxResubmissions: null,
      acceptLate: false,
    });

    expect(res.status).toBe(200);
    expect(AssignmentDetailSchema.parse(res.body)).toMatchObject({
      status: 'PUBLISHED',
      title: 'New title',
      instructions: 'New instructions.',
      dueAt: '2027-05-01T10:00:00.000Z',
      timezone: 'Asia/Manila',
      maxResubmissions: null,
      acceptLate: false,
      criteriaText: row.criteriaText,
      criteriaVersion: 1, // nothing is re-graded
    });
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).publishedAt).toEqual(row.publishedAt);
  });

  it('accepts the criteria it already has, so a form may send every field', async () => {
    const row = await seedAssignment(cls.id, published);
    const res = await patch(owner.cookie, row.id, { criteriaText: row.criteriaText, title: 'Same criteria' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Same criteria');
  });

  it('refuses a criteria change with CONFIRMATION_REQUIRED and changes nothing, not even the other fields sent with it', async () => {
    const row = await seedAssignment(cls.id, published);
    const res = await patch(owner.cookie, row.id, { criteriaText: 'Different criteria.', title: 'Changed' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONFIRMATION_REQUIRED');
    const after = await db.assignment.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ title: row.title, criteriaText: row.criteriaText, criteriaVersion: 1 });
  });

  it('recomputes Late from the new due date: a submission becomes Late when the date moves before it, and on time when it moves after', async () => {
    const row = await seedAssignment(cls.id, { ...published, dueAt: new Date(Date.now() + DAY_MS) });
    const handedIn = await submitted(cls.id, row.id, 60);
    expect((await mine(handedIn, row.id)).isLate).toBe(false);

    await patch(owner.cookie, row.id, { dueAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });
    expect((await mine(handedIn, row.id)).isLate).toBe(true);

    await patch(owner.cookie, row.id, { dueAt: new Date(Date.now() + DAY_MS).toISOString() });
    expect((await mine(handedIn, row.id)).isLate).toBe(false);
  });

  it('closes and reopens late work with the due date when late work is not accepted', async () => {
    const row = await seedAssignment(cls.id, { ...published, acceptLate: false, dueAt: new Date(Date.now() + DAY_MS) });
    const waiting = await signedInUser(`waiting-${++seeded}`, 'STUDENT');
    await db.enrollment.create({ data: { classId: cls.id, studentId: waiting.user.id, status: 'ACTIVE' } });
    expect((await mine(waiting, row.id)).closed).toBe(false);

    await patch(owner.cookie, row.id, { dueAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await mine(waiting, row.id)).closed).toBe(true);

    await patch(owner.cookie, row.id, { dueAt: new Date(Date.now() + DAY_MS).toISOString() });
    expect((await mine(waiting, row.id)).closed).toBe(false);
  });

  it('never takes back attempts already used when the limit is lowered', async () => {
    const row = await seedAssignment(cls.id, { ...published, maxResubmissions: 5 });
    const handedIn = await submitted(cls.id, row.id, 10, { resubmissionsUsed: 3 });

    const res = await patch(owner.cookie, row.id, { maxResubmissions: 1 });
    expect(res.status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { assignmentId: row.id, studentId: handedIn.user.id } })).resubmissionsUsed).toBe(
      3,
    );
    expect((await mine(handedIn, row.id)).attemptsLeft).toBe(0);
  });

  it('changes the scoring format while no submission exists, and an upload that is still open does not count as one', async () => {
    const row = await seedAssignment(cls.id, { ...published, maxScore: 50 });
    const waiting = await signedInUser(`opened-${++seeded}`, 'STUDENT');
    await db.submission.create({ data: { assignmentId: row.id, studentId: waiting.user.id } }); // the row an opened upload makes: no state yet

    const res = await patch(owner.cookie, row.id, { scoringFormat: 'PERCENTAGE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scoringFormat: 'PERCENTAGE', maxScore: 100 });
  });

  it('locks the scoring format once a submission exists (FORMAT_LOCKED) and changes nothing', async () => {
    const row = await seedAssignment(cls.id, { ...published, maxScore: 50 });
    await submitted(cls.id, row.id, 10);
    const res = await patch(owner.cookie, row.id, { scoringFormat: 'LETTER_NUMERIC', title: 'Changed' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FORMAT_LOCKED');
    const after = await db.assignment.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ title: row.title, scoringFormat: 'POINTS' });
    expect(after.maxScore.toNumber()).toBe(50);
  });

  it('still takes the other fields when the format is sent along unchanged after a submission exists', async () => {
    const row = await seedAssignment(cls.id, { ...published, maxScore: 50 });
    await submitted(cls.id, row.id, 10);
    const res = await patch(owner.cookie, row.id, { scoringFormat: 'POINTS', dueAt: '2027-06-01T10:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scoringFormat: 'POINTS', dueAt: '2027-06-01T10:00:00.000Z' });
  });

  it.each([
    ['a student', () => student.cookie],
    ['another instructor', () => other.cookie],
  ])('gives %s NOT_FOUND and changes nothing', async (_label, cookie) => {
    const row = await seedAssignment(cls.id, published);
    const res = await patch(cookie(), row.id, { title: 'Changed' });

    expect(res.status).toBe(404);
    expect((await db.assignment.findUniqueOrThrow({ where: { id: row.id } })).title).toBe(row.title);
  });

  it('is refused on an archived class', async () => {
    const archived = await seedClass(owner.user.id, { archivedAt: new Date() });
    const row = await seedAssignment(archived.id, published);
    const res = await patch(owner.cookie, row.id, { dueAt: '2027-06-01T10:00:00.000Z' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
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

describe('students read assignments (API Spec ASG-01, ASG-03)', () => {
  /** A student with a live session, joined to the class with the given status. */
  const enrolled = async (name: string, status: EnrollmentStatus, classId: string) => {
    const who = await signedInUser(name, 'STUDENT');
    await db.enrollment.create({ data: { classId, studentId: who.user.id, status } });
    return who;
  };

  let room: Awaited<ReturnType<typeof seedClass>>;
  let soon: Awaited<ReturnType<typeof seedAssignment>>;
  let later: Awaited<ReturnType<typeof seedAssignment>>;
  let draft: typeof soon;
  let archived: typeof soon;
  let approved: typeof owner;
  let pending: typeof owner;
  let declined: typeof owner;
  let removed: typeof owner;

  beforeAll(async () => {
    room = await seedClass(owner.user.id);
    const published = { status: 'PUBLISHED', publishedAt: new Date() } as const;
    later = await seedAssignment(room.id, { ...published, dueAt: new Date(Date.now() + 9 * DAY_MS), instructions: 'Write 500 words.' });
    soon = await seedAssignment(room.id, { ...published, dueAt: new Date(Date.now() + 2 * DAY_MS) });
    draft = await seedAssignment(room.id, { dueAt: new Date(Date.now() + DAY_MS) });
    archived = await seedAssignment(room.id, { status: 'ARCHIVED', publishedAt: new Date(), dueAt: new Date(Date.now() + 3 * DAY_MS) });
    approved = await enrolled('approved', 'ACTIVE', room.id);
    pending = await enrolled('pending', 'PENDING', room.id);
    declined = await enrolled('declined', 'DECLINED', room.id);
    removed = await enrolled('removed', 'REMOVED', room.id);
  });

  const list = (cookie: string, query = '') => get(build(), `/classes/${room.id}/assignments${query}`, cookie);
  const one = (cookie: string, id: string) => get(build(), `/assignments/${id}`, cookie);

  it('lists the published assignments by nearest due date, and no draft or archived one', async () => {
    const res = await list(approved.cookie);

    expect(res.status).toBe(200);
    const page = AssignmentPageSchema.parse(res.body);
    expect(page.items.map((item) => item.id)).toEqual([soon.id, later.id]);
    expect(page.items.every((item) => item.status === 'PUBLISHED')).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('pages through the published assignments', async () => {
    const first = await list(approved.cookie, '?limit=1');
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([soon.id]);

    const second = await list(approved.cookie, `?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([later.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([
    ['DRAFT', 0],
    ['ARCHIVED', 0],
    ['PUBLISHED', 2],
  ])('answers a status filter of %s with %i items: a student only ever sees published ones', async (status, count) => {
    const res = await list(approved.cookie, `?status=${status}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(count);
  });

  it('opens a published assignment, with its instructions and criteria', async () => {
    const res = await one(approved.cookie, later.id);

    expect(res.status).toBe(200);
    expect(AssignmentDetailSchema.parse(res.body)).toMatchObject({
      id: later.id,
      classId: room.id,
      status: 'PUBLISHED',
      instructions: 'Write 500 words.',
      criteriaText: 'Thesis is clear (10 points).',
    });
  });

  it.each([
    ['a draft', () => draft.id],
    ['an archived assignment', () => archived.id],
    ['an assignment that does not exist', () => randomUUID()],
  ])('gives %s NOT_FOUND, the same as a missing one', async (_label, id) => {
    const res = await one(approved.cookie, id());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('still lets an approved student read when the class is archived', async () => {
    const closed = await seedClass(owner.user.id, { archivedAt: new Date() });
    const row = await seedAssignment(closed.id, { status: 'PUBLISHED', publishedAt: new Date() });
    const student2 = await enrolled('approved-in-archived', 'ACTIVE', closed.id);

    const listed = await get(build(), `/classes/${closed.id}/assignments`, student2.cookie);
    const opened = await one(student2.cookie, row.id);

    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual([row.id]);
    expect(opened.status).toBe(200);
  });

  it('tells a pending student they are pending, for the list and for any assignment, a draft included', async () => {
    for (const res of [await list(pending.cookie), await one(pending.cookie, soon.id), await one(pending.cookie, draft.id)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ENROLLMENT_PENDING');
    }
  });

  it('tells a pending student nothing about an assignment that does not exist', async () => {
    const res = await one(pending.cookie, randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['a declined student', () => declined.cookie],
    ['a removed student', () => removed.cookie],
    ['a student who is not in the class', () => student.cookie],
  ])('gives %s NOT_FOUND', async (_label, cookie) => {
    for (const res of [await list(cookie()), await one(cookie(), soon.id)]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('gives a Super Admin NOT_FOUND: viewing is for the class and its students', async () => {
    const admin = await signedInUser('admin', 'SUPER_ADMIN');
    for (const res of [await list(admin.cookie), await one(admin.cookie, soon.id)]) {
      expect(res.status).toBe(404);
    }
  });

  it('leaves every write to the instructor: an approved student gets NOT_FOUND and changes nothing', async () => {
    const before = await db.assignment.count({ where: { classId: room.id } });

    const created = await send(build(), 'post', `/classes/${room.id}/assignments`, approved.cookie, { title: 'Mine' });
    const edited = await send(build(), 'patch', `/assignments/${draft.id}`, approved.cookie, { title: 'Mine' });
    const published = await send(build(), 'post', `/assignments/${draft.id}/publish`, approved.cookie);

    expect([created.status, edited.status, published.status]).toEqual([404, 404, 404]);
    expect(await db.assignment.count({ where: { classId: room.id } })).toBe(before);
    expect((await db.assignment.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
  });
});
