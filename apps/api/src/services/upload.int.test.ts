import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileViewSchema, LIMITS, TERMS_VERSION, VersionViewSchema, type EnrollmentStatus, type Role } from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLocalStorage } from '../lib/local-storage';
import { createLogger } from '../lib/logger';
import { uploadsRouter } from '../routes/uploads';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';
import { storeFile } from './submission-service';

// Runs against the test database, with the files in a temporary folder. Every email carries this run's ID, so tests never
// collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const BUCKET = `test-${RUN}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const db = createTestDb();
let storageDir: string;
let storage: ReturnType<typeof createLocalStorage>;

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({
    env: { APP_URL },
    logger: createLogger('silent', 'test'),
    db,
    checkDb: async () => {},
    routers: [uploadsRouter({ db, storage, bucket: BUCKET })],
  });
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
type TestUser = Awaited<ReturnType<typeof signedInUser>>;

let seeded = 0;
const seedClass = (instructorId: string, overrides: Partial<Prisma.ClassUncheckedCreateInput> = {}) =>
  db.class.create({
    data: { instructorId, name: `Seeded ${++seeded}`, joinCode: newJoinCode(), attestedAt: new Date(), ...overrides },
  });

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
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ...overrides,
    },
  });

async function enrolledStudent(name: string, classId: string, status: EnrollmentStatus = 'ACTIVE') {
  const who = await signedInUser(name, 'STUDENT');
  await db.enrollment.create({ data: { classId, studentId: who.user.id, status } });
  return who;
}

const openUpload = (app: TestApp, assignmentId: string, cookie?: string) => {
  const req = request(app).post(`/api/assignments/${assignmentId}/versions`).set('Origin', APP_URL);
  return cookie ? req.set('Cookie', cookie) : req;
};

const PDF = Buffer.from('%PDF-1.4\n% a tiny pretend document\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend image data')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pretend image data')]);

type SendOptions = { contentType?: string; name?: string | null; clientFileId?: string };
let fileCounter = 0;
const sendFile = (app: TestApp, versionId: string, cookie: string, body: Buffer, options: SendOptions = {}) => {
  const clientFileId = options.clientFileId ?? `file-${RUN}-${++fileCounter}`;
  const req = request(app)
    .put(`/api/versions/${versionId}/files/${clientFileId}`)
    .set('Origin', APP_URL)
    .set('Cookie', cookie)
    .set('Content-Type', options.contentType ?? 'application/pdf');
  if (options.name !== null) req.set('X-File-Name', encodeURIComponent(options.name ?? 'essay.pdf'));
  return req.send(body);
};

let owner: TestUser;
let cls: Awaited<ReturnType<typeof seedClass>>;
let student: TestUser;

beforeAll(async () => {
  await db.$connect();
  storageDir = await mkdtemp(join(tmpdir(), 'edugemini-upload-test-'));
  storage = createLocalStorage({ dir: storageDir, appUrl: APP_URL, secret: 'a-test-secret-of-at-least-32-characters' });
  owner = await signedInUser('owner', 'INSTRUCTOR');
  cls = await seedClass(owner.user.id);
  student = await enrolledStudent('student', cls.id);
});

afterAll(async () => {
  await db.storageDeletion.deleteMany({ where: { bucket: BUCKET } });
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // assignments, submissions, files go with it
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe('POST /api/assignments/:id/versions (SUB-02)', () => {
  it('opens version 1 and makes the submission, without using an attempt', async () => {
    const assignment = await seedAssignment(cls.id);
    const res = await openUpload(build(), assignment.id, student.cookie);

    expect(res.status).toBe(201);
    const version = VersionViewSchema.parse(res.body);
    expect(version).toMatchObject({ versionNo: 1, status: 'UPLOADING', storedAt: null });
    const submission = await db.submission.findUniqueOrThrow({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.user.id } },
    });
    expect(submission).toMatchObject({ state: null, currentVersionId: null, resubmissionsUsed: 0 });
  });

  it('gives the same version again while one is open', async () => {
    const assignment = await seedAssignment(cls.id);
    const first = await openUpload(build(), assignment.id, student.cookie);
    const again = await openUpload(build(), assignment.id, student.cookie);

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await db.submissionVersion.count({ where: { submission: { assignmentId: assignment.id } } })).toBe(1);
  });

  it('gives one version to two requests at the same moment', async () => {
    const assignment = await seedAssignment(cls.id);
    const app = build();
    const [a, b] = await Promise.all([openUpload(app, assignment.id, student.cookie), openUpload(app, assignment.id, student.cookie)]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
  });

  it('is NOT_FOUND for a draft, a missing assignment and an instructor, and 401 signed out', async () => {
    const draft = await seedAssignment(cls.id, { status: 'DRAFT', publishedAt: null });
    expect((await openUpload(build(), draft.id, student.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await openUpload(build(), randomUUID(), student.cookie)).body.error.code).toBe('NOT_FOUND');
    const published = await seedAssignment(cls.id);
    expect((await openUpload(build(), published.id, owner.cookie)).status).toBe(404);
    expect((await openUpload(build(), published.id)).status).toBe(401);
  });

  it('tells a pending student they are pending, and shows a declined, removed or outside student nothing', async () => {
    const assignment = await seedAssignment(cls.id);
    const pending = await enrolledStudent('pending', cls.id, 'PENDING');
    const declined = await enrolledStudent('declined', cls.id, 'DECLINED');
    const removed = await enrolledStudent('removed', cls.id, 'REMOVED');
    const outsider = await signedInUser('outsider', 'STUDENT');

    expect((await openUpload(build(), assignment.id, pending.cookie)).body.error.code).toBe('ENROLLMENT_PENDING');
    for (const who of [declined, removed, outsider]) {
      expect((await openUpload(build(), assignment.id, who.cookie)).body.error.code).toBe('NOT_FOUND');
    }
  });

  it('is CLASS_ARCHIVED in an archived class', async () => {
    const archived = await seedClass(owner.user.id, { archivedAt: new Date() });
    const member = await enrolledStudent('archived-member', archived.id);
    const assignment = await seedAssignment(archived.id);
    const res = await openUpload(build(), assignment.id, member.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
  });

  it('opens a new version after the earlier one is stored, numbered after it', async () => {
    const assignment = await seedAssignment(cls.id);
    const first = await openUpload(build(), assignment.id, student.cookie);
    await db.submissionVersion.update({ where: { id: first.body.id }, data: { status: 'STORED', storedAt: new Date() } });

    const next = await openUpload(build(), assignment.id, student.cookie);
    expect(next.status).toBe(201);
    expect(next.body.versionNo).toBe(2);
  });
});

describe('PUT /api/versions/:id/files/:clientFileId (SUB-03)', () => {
  let assignment: Awaited<ReturnType<typeof seedAssignment>>;
  let versionId: string;

  /** A fresh open version for the shared student, so each test starts with no files. */
  async function freshVersion() {
    assignment = await seedAssignment(cls.id);
    versionId = (await openUpload(build(), assignment.id, student.cookie)).body.id;
    return versionId;
  }

  it('stores a PDF under a path made of IDs, with the row and the object to match', async () => {
    await freshVersion();
    const res = await sendFile(build(), versionId, student.cookie, PDF, { name: 'My essay (final).pdf' });

    expect(res.status).toBe(201);
    const file = FileViewSchema.parse(res.body);
    expect(file).toMatchObject({ ordinal: 1, displayName: 'My essay (final).pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, status: 'STORED', failureCode: null });

    const row = await db.submissionFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(row.storagePath).toMatch(new RegExp(`^submissions/${cls.id}/${assignment.id}/${student.user.id}/${versionId}/1-[0-9a-f-]{36}\\.pdf$`));
    expect(row.storagePath).not.toContain('essay'); // the name the student gave is never part of a path
    expect(await storage.exists(BUCKET, row.storagePath!)).toBe(true);
  });

  it('stores JPEG and PNG, and numbers the files in the order they arrive', async () => {
    await freshVersion();
    const png = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png', name: 'a.png' });
    const jpeg = await sendFile(build(), versionId, student.cookie, JPEG, { contentType: 'image/jpeg', name: 'b.jpg' });

    expect(png.body).toMatchObject({ ordinal: 1, mimeType: 'image/png' });
    expect(jpeg.body).toMatchObject({ ordinal: 2, mimeType: 'image/jpeg' });
  });

  it('goes by the content, not by the name or the type the browser declared', async () => {
    await freshVersion();
    const png = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'application/pdf', name: 'looks-like.pdf' });
    expect(png.status).toBe(201);
    expect(png.body.mimeType).toBe('image/png');

    const unknownType = await sendFile(build(), versionId, student.cookie, PDF, { contentType: 'application/octet-stream' });
    expect(unknownType.status).toBe(201);
    expect(unknownType.body.mimeType).toBe('application/pdf');
  });

  it('refuses text called .pdf with FILE_TYPE and stores nothing', async () => {
    await freshVersion();
    const res = await sendFile(build(), versionId, student.cookie, Buffer.from('just some text'), { name: 'essay.pdf' });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE');
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(0);
  });

  it('refuses a HEIC photo and an empty file with FILE_TYPE', async () => {
    await freshVersion();
    const heic = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic')]);
    expect((await sendFile(build(), versionId, student.cookie, heic, { contentType: 'image/heic' })).body.error.code).toBe('FILE_TYPE');
    expect((await sendFile(build(), versionId, student.cookie, Buffer.alloc(0))).body.error.code).toBe('FILE_TYPE');
  });

  it('refuses a body whose Content-Length is over 10 MiB without reading it', async () => {
    await freshVersion();
    const res = await request(build())
      .put(`/api/versions/${versionId}/files/file-${RUN}-big`)
      .set('Origin', APP_URL)
      .set('Cookie', student.cookie)
      .set('Content-Type', 'application/pdf')
      .set('Content-Length', String(LIMITS.maxFileBytes + 1))
      .send(PDF); // fewer bytes than it claims: the answer comes from the header alone
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('stops a body over 10 MiB that arrives with no honest length, and stores nothing', async () => {
    await freshVersion();
    const tooBig = Readable.from([Buffer.concat([PDF, Buffer.alloc(LIMITS.maxFileBytes)])]);
    const before = await db.submissionFile.count({ where: { versionId } });

    await expect(
      storeFile(db, storage, BUCKET, student.user, versionId, `file-${RUN}-stream`, { body: tooBig, displayName: 'big.pdf' }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(before);
  });

  it('accepts a file of exactly 10 MiB', async () => {
    await freshVersion();
    const exact = Buffer.concat([PDF, Buffer.alloc(LIMITS.maxFileBytes - PDF.length)]);
    const res = await sendFile(build(), versionId, student.cookie, exact);
    expect(res.status).toBe(201);
    expect(res.body.sizeBytes).toBe(LIMITS.maxFileBytes);
  });

  it('replaces a file sent again with the same clientFileId, and queues the old object for deletion', async () => {
    await freshVersion();
    const first = await sendFile(build(), versionId, student.cookie, PDF, { clientFileId: `same-${RUN}-1`, name: 'v1.pdf' });
    const oldRow = await db.submissionFile.findUniqueOrThrow({ where: { id: first.body.id } });

    const second = await sendFile(build(), versionId, student.cookie, PNG, { clientFileId: `same-${RUN}-1`, name: 'v2.png' });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, ordinal: 1, displayName: 'v2.png', mimeType: 'image/png' });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(1);
    const newRow = await db.submissionFile.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(newRow.storagePath).not.toBe(oldRow.storagePath);
    expect(await storage.exists(BUCKET, newRow.storagePath!)).toBe(true);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: oldRow.storagePath! } })).toBe(1);
  });

  it('takes ten files and refuses the eleventh with FILE_LIMIT', async () => {
    await freshVersion();
    for (let i = 1; i <= LIMITS.filesPerSubmission; i++) {
      expect((await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' })).status).toBe(201);
    }
    const res = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'files' } });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(LIMITS.filesPerSubmission);

    // A file already there can still be replaced when the version is full.
    const existing = await db.submissionFile.findFirstOrThrow({ where: { versionId }, orderBy: { ordinal: 'asc' } });
    const replace = await sendFile(build(), versionId, student.cookie, PDF, { clientFileId: existing.clientFileId });
    expect(replace.status).toBe(200);
  });

  it('uses a free place first, so a removed file does not use up the count', async () => {
    await freshVersion();
    for (let i = 0; i < 3; i++) await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    await db.submissionFile.deleteMany({ where: { versionId, ordinal: 2 } });

    const res = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    expect(res.body.ordinal).toBe(2);
  });

  it('is UPLOAD_NOT_OPEN once the version is stored', async () => {
    await freshVersion();
    await db.submissionVersion.update({ where: { id: versionId }, data: { status: 'STORED', storedAt: new Date() } });
    const res = await sendFile(build(), versionId, student.cookie, PDF);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UPLOAD_NOT_OPEN');
  });

  it('is NOT_FOUND for another student, an instructor and a missing version, and 401 signed out', async () => {
    await freshVersion();
    const classmate = await enrolledStudent('classmate', cls.id);
    expect((await sendFile(build(), versionId, classmate.cookie, PDF)).body.error.code).toBe('NOT_FOUND');
    expect((await sendFile(build(), versionId, owner.cookie, PDF)).status).toBe(404);
    expect((await sendFile(build(), randomUUID(), student.cookie, PDF)).status).toBe(404);
    const signedOut = await request(build()).put(`/api/versions/${versionId}/files/file-${RUN}-x1`).set('Origin', APP_URL).set('Content-Type', 'application/pdf').send(PDF);
    expect(signedOut.status).toBe(401);
  });

  it('refuses a student who was removed after opening the upload', async () => {
    const leaver = await enrolledStudent('leaver', cls.id);
    const room = await seedAssignment(cls.id);
    const opened = await openUpload(build(), room.id, leaver.cookie);
    await db.enrollment.update({ where: { classId_studentId: { classId: cls.id, studentId: leaver.user.id } }, data: { status: 'REMOVED' } });

    expect((await sendFile(build(), opened.body.id, leaver.cookie, PDF)).body.error.code).toBe('NOT_FOUND');
  });

  it('is UNSUPPORTED_MEDIA_TYPE for a request that is not a file upload', async () => {
    await freshVersion();
    const res = await request(build())
      .put(`/api/versions/${versionId}/files/file-${RUN}-json`)
      .set('Origin', APP_URL)
      .set('Cookie', student.cookie)
      .send({ not: 'a file' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('is VALIDATION for a clientFileId that is too short', async () => {
    await freshVersion();
    const res = await sendFile(build(), versionId, student.cookie, PDF, { clientFileId: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('shows a missing, broken or very long name safely', async () => {
    await freshVersion();
    expect((await sendFile(build(), versionId, student.cookie, PDF, { name: null })).body.displayName).toBe('file');

    const broken = await request(build())
      .put(`/api/versions/${versionId}/files/file-${RUN}-broken`)
      .set('Origin', APP_URL)
      .set('Cookie', student.cookie)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', '%E0%A4%A') // not a valid encoding
      .send(PDF);
    expect(broken.body.displayName).toBe('file');

    const long = await sendFile(build(), versionId, student.cookie, PDF, { name: `${'é'.repeat(200)}.pdf` });
    expect(Buffer.byteLength(long.body.displayName)).toBeLessThanOrEqual(255);
    expect(long.body.displayName.startsWith('é')).toBe(true);
  });

  it('applies the upload limit of 60 requests a minute to each student', async () => {
    const app = build();
    const assignment = await seedAssignment(cls.id);
    const busy = await enrolledStudent('busy', cls.id);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await openUpload(app, assignment.id, busy.cookie)).status);

    expect(statuses.slice(0, 60).every((status) => status === 200 || status === 201)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
