import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TERMS_VERSION, type EnrollmentStatus, type Role } from '@edugemini/shared';
import { createApp } from './app';
import { createSession, SESSION_COOKIE } from './auth/session';
import { createMemoryStorage } from './test/memory-storage';
import { createLogger } from './lib/logger';
import { keyRouter } from './routes/key';
import { uploadsRouter } from './routes/uploads';
import { newJoinCode } from './services/class-service';
import { createTestDb } from './test/test-db';

// Every route against the permission matrix (PRD §5.1, API Spec A3), including the deny paths (EG-QA-01).
//
// Each row is one route. It is called by every actor below, in the order listed, against one fresh class made for that row, and the
// answers are compared with what the docs say: the status and the error code. Every route has an allow row, so a route that is
// missing, or a router that is not mounted, shows up as a failed allow and cannot hide behind a deny answer of 404.
//
// Expected answers come from API Spec A3, not from policy.ts:
//   no session            401 UNAUTHENTICATED          suspended           403 ACCOUNT_SUSPENDED
//   pending student       403 ENROLLMENT_PENDING       wrong role, no relationship, declined or removed student   404 NOT_FOUND
// An actor that is not named in a row's `ok` or `special` gets those defaults. The actors that change something (student and
// owner) go last, so an allowed request cannot change what a denied one sees.
//
// Not in the table: /healthz (public, no data), /auth/* (public; the sign-in tests cover them) and /dev/files (signed links, its
// own tests). Rows owed to tickets that are not built are `it.todo` at the end.

const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend image data')]);

const db = createTestDb();
const storage = createMemoryStorage();
const ENV = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENCRYPTION_KEY_VERSION: 1 };

// A fresh app per request, so the in-memory rate limits start empty each time.
const build = () =>
  createApp({
    env: { APP_URL, STORAGE_BUCKET: 'test-bucket' },
    logger: createLogger('silent', 'test'),
    db,
    checkDb: async () => {},
    routers: [keyRouter({ db, env: ENV }), uploadsRouter({ db, storage, bucket: `matrix-${RUN}`, enqueueGrading: async () => {} })],
  });

// ---------------------------------------------------------------- the people

// Students first, then instructors and the admin. `student` and `owner` are the ones the rows let in.
const ACTORS = ['anon', 'suspended', 'outsider', 'removed', 'declined', 'pending', 'peer', 'other', 'admin', 'student', 'owner'] as const;
type Actor = (typeof ACTORS)[number];
type Result = readonly [status: number, code?: string];

const ROLE: Record<Exclude<Actor, 'anon'>, Role> = {
  suspended: 'STUDENT', // approved in the class, so only the suspension can stop them
  outsider: 'STUDENT', // never joined
  removed: 'STUDENT',
  declined: 'STUDENT',
  pending: 'STUDENT',
  peer: 'STUDENT', // approved in the same class, a different student from `student`
  student: 'STUDENT',
  owner: 'INSTRUCTOR', // owns the class of every row
  other: 'INSTRUCTOR', // owns nothing in it
  admin: 'SUPER_ADMIN',
};
const ENROLLED: Partial<Record<Actor, EnrollmentStatus>> = {
  suspended: 'ACTIVE',
  removed: 'REMOVED',
  declined: 'DECLINED',
  pending: 'PENDING',
  peer: 'ACTIVE',
  student: 'ACTIVE',
};

type Person = { id: string; cookie: string };
const people = {} as Record<Exclude<Actor, 'anon'>, Person>;

async function makePerson(name: Exclude<Actor, 'anon'>): Promise<Person> {
  const user = await db.user.create({
    data: {
      email: `${name}${EMAIL_END}`,
      firstName: 'Ada',
      lastName: name,
      role: ROLE[name],
      termsAcceptedAt: new Date(), // the database requires it (users_terms_required)
      termsVersion: TERMS_VERSION,
      suspendedAt: name === 'suspended' ? new Date() : null,
    },
  });
  return { id: user.id, cookie: `${SESSION_COOKIE}=${await createSession(db, user.id)}` };
}

// ---------------------------------------------------------------- one world per row

type World = {
  classId: string;
  code: string;
  draftId: string;
  publishedId: string;
  enrollmentId: string; // `student`'s enrollment
  notificationId: string; // `student`'s notification
  versionId: string; // `student`'s open upload; empty unless the row asks for it
};

let seeded = 0;
async function seedWorld(withVersion: boolean): Promise<World> {
  const cls = await db.class.create({
    data: { instructorId: people.owner.id, name: `Matrix ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date() },
  });
  const assignment = (overrides: Partial<Prisma.AssignmentUncheckedCreateInput>) =>
    db.assignment.create({
      data: {
        classId: cls.id,
        title: `Matrix assignment ${++seeded}`,
        criteriaText: 'Thesis is clear (10 points).',
        dueAt: new Date(Date.now() + 7 * DAY_MS),
        timezone: 'UTC',
        scoringFormat: 'POINTS',
        maxScore: 100,
        maxResubmissions: 3,
        ...overrides,
      },
    });
  const draft = await assignment({ status: 'DRAFT' });
  const published = await assignment({ status: 'PUBLISHED', publishedAt: new Date() });

  const enrollments: Record<string, string> = {};
  for (const [name, status] of Object.entries(ENROLLED)) {
    const row = await db.enrollment.create({ data: { classId: cls.id, studentId: people[name as keyof typeof people].id, status } });
    enrollments[name] = row.id;
  }
  const note = await db.notification.create({
    data: { userId: people.student.id, type: 'SUBMISSION_GRADED', payload: {}, link: `/assignments/${published.id}` },
  });

  let versionId = '';
  if (withVersion) {
    const res = await request(build())
      .post(`/api/assignments/${published.id}/versions`)
      .set('Origin', APP_URL)
      .set('Cookie', people.student.cookie);
    versionId = res.body.id as string;
  }
  return {
    classId: cls.id,
    code: cls.joinCode,
    draftId: draft.id,
    publishedId: published.id,
    enrollmentId: enrollments.student!,
    notificationId: note.id,
    versionId,
  };
}

// ---------------------------------------------------------------- the rows

type Row = {
  name: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: (w: World) => string;
  body?: object | Buffer | ((w: World) => object);
  /** Only for the file upload, which is raw bytes. */
  contentType?: string;
  /** The row needs `student` to have an upload open. */
  version?: boolean;
  /** Who is let in, and what they get. */
  ok: readonly Actor[];
  okResult: Result;
  /** Everyone else gets the default for their situation unless named here. */
  special?: Partial<Record<Actor, Result>>;
};

const UNAUTHENTICATED: Result = [401, 'UNAUTHENTICATED'];
const SUSPENDED: Result = [403, 'ACCOUNT_SUSPENDED'];
const PENDING: Result = [403, 'ENROLLMENT_PENDING'];
const NOT_FOUND: Result = [404, 'NOT_FOUND'];
const INSTRUCTORS = ['owner', 'other'] as const;
const MEMBERS = ['student', 'peer'] as const; // approved students
const STUDENTS = ['student', 'peer', 'pending', 'declined', 'removed', 'outsider'] as const; // what `class.listEnrolled` lets in (not the suspended one)

const show = ([status, code]: Result) => (code ? `${status} ${code}` : String(status));

const expected = (row: Row, actor: Actor): Result => {
  if (row.special?.[actor]) return row.special[actor];
  if (row.ok.includes(actor)) return row.okResult;
  if (actor === 'anon') return UNAUTHENTICATED;
  if (actor === 'suspended') return SUSPENDED;
  return NOT_FOUND;
};

const newApiKey = () => `AIza${randomBytes(18).toString('hex')}`;
const FILE_ID = 'matrix-file-1';

const ROWS: Row[] = [
  // --- the account and the notification center: any signed-in user
  { name: 'GET /me', method: 'get', path: () => '/api/me', ok: [...STUDENTS, ...INSTRUCTORS, 'admin'], okResult: [200] },
  {
    name: 'GET /notifications',
    method: 'get',
    path: () => '/api/notifications',
    ok: [...STUDENTS, ...INSTRUCTORS, 'admin'],
    okResult: [200],
  },
  {
    name: 'GET /notifications/unread-count',
    method: 'get',
    path: () => '/api/notifications/unread-count',
    ok: [...STUDENTS, ...INSTRUCTORS, 'admin'],
    okResult: [200],
  },
  {
    name: 'POST /notifications/read-all',
    method: 'post',
    path: () => '/api/notifications/read-all',
    ok: [...STUDENTS, ...INSTRUCTORS, 'admin'],
    okResult: [200],
  },
  // only the recipient: a notification of someone else is NOT_FOUND
  {
    name: "POST /notifications/{id}/read (only the recipient's own)",
    method: 'post',
    path: (w) => `/api/notifications/${w.notificationId}/read`,
    ok: ['student'],
    okResult: [204],
  },

  // --- the key: instructors only
  { name: 'GET /me/key', method: 'get', path: () => '/api/me/key', ok: INSTRUCTORS, okResult: [200] },
  {
    name: 'PUT /me/key',
    method: 'put',
    path: () => '/api/me/key',
    body: { apiKey: newApiKey(), disclosureAcknowledged: true },
    ok: INSTRUCTORS,
    okResult: [200],
  },
  { name: 'DELETE /me/key', method: 'delete', path: () => '/api/me/key', ok: INSTRUCTORS, okResult: [204] },

  // --- joining: students only; the link preview is public
  {
    name: 'GET /join/{code} (public; an instructor is told they cannot join)',
    method: 'get',
    path: (w) => `/api/join/${w.code}`,
    ok: ['anon', 'suspended', ...STUDENTS, 'admin'],
    okResult: [200],
    special: { other: [403, 'INSTRUCTOR_CANNOT_JOIN'], owner: [403, 'INSTRUCTOR_CANNOT_JOIN'] },
  },
  {
    name: 'POST /join',
    method: 'post',
    path: () => '/api/join',
    body: (w) => ({ code: w.code }),
    ok: ['student', 'peer', 'pending', 'declined'], // already in: nothing new, 200
    okResult: [200],
    special: {
      outsider: [201],
      removed: [403, 'JOIN_BLOCKED'],
      other: [403, 'INSTRUCTOR_CANNOT_JOIN'],
      owner: [403, 'INSTRUCTOR_CANNOT_JOIN'],
    },
  },

  // --- classes
  {
    name: 'POST /classes',
    method: 'post',
    path: () => '/api/classes',
    body: { name: 'Matrix class', attestation: { confirmed: true } },
    ok: INSTRUCTORS,
    okResult: [201],
  },
  { name: 'GET /classes', method: 'get', path: () => '/api/classes', ok: INSTRUCTORS, okResult: [200] },
  { name: 'GET /me/enrollments', method: 'get', path: () => '/api/me/enrollments', ok: STUDENTS, okResult: [200] },
  {
    name: 'GET /classes/{id}',
    method: 'get',
    path: (w) => `/api/classes/${w.classId}`,
    ok: ['owner', ...MEMBERS],
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    name: 'PATCH /classes/{id}',
    method: 'patch',
    path: (w) => `/api/classes/${w.classId}`,
    body: { name: 'Renamed' },
    ok: ['owner'],
    okResult: [200],
  },
  { name: 'POST /classes/{id}/archive', method: 'post', path: (w) => `/api/classes/${w.classId}/archive`, ok: ['owner'], okResult: [200] },
  { name: 'POST /classes/{id}/restore', method: 'post', path: (w) => `/api/classes/${w.classId}/restore`, ok: ['owner'], okResult: [200] },
  {
    name: 'POST /classes/{id}/code/regenerate',
    method: 'post',
    path: (w) => `/api/classes/${w.classId}/code/regenerate`,
    ok: ['owner'],
    okResult: [200],
  },
  {
    name: 'POST /classes/{id}/code/disable',
    method: 'post',
    path: (w) => `/api/classes/${w.classId}/code/disable`,
    ok: ['owner'],
    okResult: [200],
  },

  // --- people and join approval: the owning instructor only
  {
    name: 'PATCH /classes/{id}/settings',
    method: 'patch',
    path: (w) => `/api/classes/${w.classId}/settings`,
    body: { requireApproval: true },
    ok: ['owner'],
    okResult: [200],
  },
  { name: 'GET /classes/{id}/people', method: 'get', path: (w) => `/api/classes/${w.classId}/people`, ok: ['owner'], okResult: [200] },
  {
    name: 'POST /classes/{id}/approve-pending',
    method: 'post',
    path: (w) => `/api/classes/${w.classId}/approve-pending`,
    ok: ['owner'],
    okResult: [200],
  },
  {
    name: 'POST /enrollments/{id}/decision',
    method: 'post',
    path: (w) => `/api/enrollments/${w.enrollmentId}/decision`,
    body: { action: 'REMOVE' },
    ok: ['owner'],
    okResult: [200],
  },

  // --- assignments
  {
    name: 'POST /classes/{id}/assignments',
    method: 'post',
    path: (w) => `/api/classes/${w.classId}/assignments`,
    body: { title: 'New one' },
    ok: ['owner'],
    okResult: [201],
  },
  {
    name: 'GET /classes/{id}/assignments',
    method: 'get',
    path: (w) => `/api/classes/${w.classId}/assignments`,
    ok: ['owner', ...MEMBERS],
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    name: 'GET /assignments/{id} (published)',
    method: 'get',
    path: (w) => `/api/assignments/${w.publishedId}`,
    ok: ['owner', ...MEMBERS],
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    // a student never sees a draft; a pending student is told to wait before the draft check (API Spec A3)
    name: 'GET /assignments/{id} (draft)',
    method: 'get',
    path: (w) => `/api/assignments/${w.draftId}`,
    ok: ['owner'],
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    name: 'PATCH /assignments/{id}',
    method: 'patch',
    path: (w) => `/api/assignments/${w.draftId}`,
    body: { title: 'Edited' },
    ok: ['owner'],
    okResult: [200],
  },
  {
    name: 'POST /assignments/{id}/publish',
    method: 'post',
    path: (w) => `/api/assignments/${w.draftId}/publish`,
    ok: ['owner'],
    okResult: [200],
  },

  // --- a student's submission: approved students only, and only their own upload
  {
    name: 'GET /assignments/{id}/me',
    method: 'get',
    path: (w) => `/api/assignments/${w.publishedId}/me`,
    ok: MEMBERS,
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    name: 'GET /assignments/{id}/me (draft: not found for a student)',
    method: 'get',
    path: (w) => `/api/assignments/${w.draftId}/me`,
    ok: [],
    okResult: [200],
    special: { pending: PENDING },
  },
  {
    name: 'POST /assignments/{id}/versions',
    method: 'post',
    path: (w) => `/api/assignments/${w.publishedId}/versions`,
    ok: MEMBERS,
    okResult: [201],
    special: { pending: PENDING },
  },
  {
    name: "PUT /versions/{id}/files/{fileId} (only the student's own upload)",
    method: 'put',
    path: (w) => `/api/versions/${w.versionId}/files/${FILE_ID}`,
    body: PNG,
    contentType: 'image/png',
    version: true,
    ok: ['student'],
    okResult: [201],
  },
  {
    name: 'DELETE /versions/{id}/files/{fileId}',
    method: 'delete',
    path: (w) => `/api/versions/${w.versionId}/files/${FILE_ID}`,
    version: true,
    ok: ['student'],
    okResult: [204],
  },
  {
    // nothing is stored in this upload, so being let in ends at the service's own refusal, which a denied caller never reaches
    name: 'POST /versions/{id}/finalize',
    method: 'post',
    path: (w) => `/api/versions/${w.versionId}/finalize`,
    body: { expectedFileIds: [FILE_ID] },
    version: true,
    ok: ['student'],
    okResult: [409, 'UPLOAD_INCOMPLETE'],
  },
];

// A request, with the Origin header every mutation needs, even from a caller with no session.
async function call(row: Row, world: World, actor: Actor): Promise<string> {
  const path = row.path(world);
  const body = typeof row.body === 'function' ? row.body(world) : row.body;
  let req = request(build())[row.method](path);
  if (row.method !== 'get') req = req.set('Origin', APP_URL);
  if (actor !== 'anon') req = req.set('Cookie', people[actor].cookie);
  if (row.contentType) req = req.set('Content-Type', row.contentType);
  const res = await (body === undefined ? req : req.send(body as object));
  return show([res.status, res.body?.error?.code as string | undefined]);
}

beforeAll(async () => {
  await db.$connect();
  for (const name of Object.keys(ROLE) as (keyof typeof people)[]) people[name] = await makePerson(name);
});

afterAll(async () => {
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // a class blocks deleting its instructor
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
});

describe('authorization matrix (PRD §5.1, API Spec A3)', () => {
  it.each(ROWS)(
    '$name',
    async (row) => {
      const world = await seedWorld(row.version === true);
      const got: Partial<Record<Actor, string>> = {};
      const want: Partial<Record<Actor, string>> = {};
      for (const actor of ACTORS) {
        got[actor] = await call(row, world, actor);
        want[actor] = show(expected(row, actor));
      }
      // One comparison per row, so a failure lists every actor that got the wrong answer.
      expect(got).toEqual(want);
    },
    90_000,
  );

  // Owed to tickets that are not built. When each lands, its row goes in the table above.
  it.todo('Super Admin archives a class (PRD §5.1; API Spec CLS-05 "✓ (ADM-07)"): the route refuses admin today; owed to ADM-03');
  it.todo('Super Admin deletes a class, suspends and reinstates accounts, reads platform health: owed to ADM-02, ADM-03, ADM-05');
  it.todo('Delete own account (instructor, student): owed to AUTH-10');
});
