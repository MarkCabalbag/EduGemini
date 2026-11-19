import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FileViewSchema,
  LIMITS,
  MiB,
  ReferenceFileLinkSchema,
  ReferenceFileViewSchema,
  StudentSubmissionSchema,
  TERMS_VERSION,
  VersionViewSchema,
  type EnrollmentStatus,
  type GradeJob,
  type Role,
} from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createMemoryStorage } from '../test/memory-storage';
import { createLogger } from '../lib/logger';
import { uploadsRouter } from '../routes/uploads';
import { ENCRYPTED_PDF, makePdf } from '../test/pdf-fixtures';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';
import type { EnqueueGrading } from './grading-service';
import { storeFile } from './submission-file-service';
import { deleteStagedUploads } from './submission-service';

// Runs against the test database, with the files in a temporary folder. Every email carries this run's ID, so tests never
// collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const BUCKET = `test-${RUN}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const db = createTestDb();
const storage = createMemoryStorage();

// Finalize sends a grading job (AI-08). The tests record the jobs instead of running a worker; a test can replace `sender`.
const sent: GradeJob[] = [];
const recordJobs: EnqueueGrading = async (job) => {
  sent.push(job);
};
let sender = recordJobs;
afterEach(() => {
  sender = recordJobs;
});

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({
    env: { APP_URL, STORAGE_BUCKET: 'test-bucket' },
    logger: createLogger('silent', 'test'),
    db,
    checkDb: async () => {},
    routers: [uploadsRouter({ db, storage, bucket: BUCKET, enqueueGrading: (job) => sender(job) })],
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

let PDF: Buffer; // a real one-page PDF, made in beforeAll: the server opens every PDF to count its pages
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend image data')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pretend image data')]);
/** A PNG of exactly this many bytes, so size limits can be hit to the byte. */
const pngOfSize = (bytes: number) => Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length)]);

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
  PDF = await makePdf(1);
  owner = await signedInUser('owner', 'INSTRUCTOR');
  cls = await seedClass(owner.user.id);
  student = await enrolledStudent('student', cls.id);
});

afterAll(async () => {
  await db.storageDeletion.deleteMany({ where: { bucket: BUCKET } });
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // assignments, submissions, files go with it
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
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
    expect(file).toMatchObject({
      ordinal: 1,
      displayName: 'My essay (final).pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      status: 'STORED',
      failureCode: null,
    });

    const row = await db.submissionFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(row.storagePath).toMatch(
      new RegExp(`^submissions/${cls.id}/${assignment.id}/${student.user.id}/${versionId}/1-[0-9a-f-]{36}\\.pdf$`),
    );
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
    const res = await sendFile(build(), versionId, student.cookie, pngOfSize(LIMITS.maxFileBytes), { contentType: 'image/png' });
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

  it('keeps the page count of a PDF, and none for an image', async () => {
    await freshVersion();
    const pdf = await sendFile(build(), versionId, student.cookie, await makePdf(3));
    const png = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });

    expect(FileViewSchema.parse(pdf.body).pageCount).toBe(3);
    expect((await db.submissionFile.findUniqueOrThrow({ where: { id: pdf.body.id } })).pageCount).toBe(3);
    expect(png.body.pageCount).toBeNull();
  });

  it('takes a PDF of 20 pages and refuses one of 21 with FILE_LIMIT, storing nothing', async () => {
    await freshVersion();
    expect((await sendFile(build(), versionId, student.cookie, await makePdf(LIMITS.maxPdfPages))).status).toBe(201);

    const tooLong = await sendFile(build(), versionId, student.cookie, await makePdf(LIMITS.maxPdfPages + 1));
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'pages' } });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(1);
  });

  it('refuses a password-protected PDF and a broken one with FILE_ERROR, storing nothing', async () => {
    await freshVersion();
    const locked = await sendFile(build(), versionId, student.cookie, ENCRYPTED_PDF);
    expect(locked.status).toBe(422);
    expect(locked.body.error).toMatchObject({ code: 'FILE_ERROR', details: { failureCode: 'PASSWORD' } });

    const broken = await sendFile(build(), versionId, student.cookie, PDF.subarray(0, Math.floor(PDF.length / 2)));
    expect(broken.body.error).toMatchObject({ code: 'FILE_ERROR', details: { failureCode: 'CORRUPT' } });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(0);
  });

  it('takes files up to 15 MiB in all, and refuses the one that goes over with FILE_LIMIT, storing nothing', async () => {
    await freshVersion();
    for (let i = 0; i < 3; i++) {
      const res = await sendFile(build(), versionId, student.cookie, pngOfSize(5 * MiB), { contentType: 'image/png' });
      expect(res.status).toBe(201);
    }
    const over = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'total-size' } });
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(3);
  });

  it('counts a replacement by its own size, not on top of the file it replaces', async () => {
    await freshVersion();
    const clientFileId = `swap-${RUN}-1`;
    await sendFile(build(), versionId, student.cookie, pngOfSize(5 * MiB), { contentType: 'image/png', clientFileId });
    await sendFile(build(), versionId, student.cookie, pngOfSize(10 * MiB), { contentType: 'image/png' }); // 15 MiB in all

    const same = await sendFile(build(), versionId, student.cookie, pngOfSize(5 * MiB), { contentType: 'image/png', clientFileId });
    expect(same.status).toBe(200);
    const bigger = await sendFile(build(), versionId, student.cookie, pngOfSize(5 * MiB + 1), { contentType: 'image/png', clientFileId });
    expect(bigger.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'total-size' } });
  });

  it('clears the page count when an image replaces a PDF', async () => {
    await freshVersion();
    const clientFileId = `swap-${RUN}-2`;
    const pdf = await sendFile(build(), versionId, student.cookie, await makePdf(2), { clientFileId });
    expect(pdf.body.pageCount).toBe(2);

    const png = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png', clientFileId });
    expect(png.body.pageCount).toBeNull();
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
    const signedOut = await request(build())
      .put(`/api/versions/${versionId}/files/file-${RUN}-x1`)
      .set('Origin', APP_URL)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(signedOut.status).toBe(401);
  });

  it('refuses a student who was removed after opening the upload', async () => {
    const leaver = await enrolledStudent('leaver', cls.id);
    const room = await seedAssignment(cls.id);
    const opened = await openUpload(build(), room.id, leaver.cookie);
    await db.enrollment.update({
      where: { classId_studentId: { classId: cls.id, studentId: leaver.user.id } },
      data: { status: 'REMOVED' },
    });

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
  }, 60_000); // 61 round trips to the hosted test database: close to the default 30 s on a slow connection
});

const finalize = (app: TestApp, versionId: string, cookie: string, expectedFileIds: string[]) =>
  request(app).post(`/api/versions/${versionId}/finalize`).set('Origin', APP_URL).set('Cookie', cookie).send({ expectedFileIds });

const getMine = (app: TestApp, assignmentId: string, cookie?: string) => {
  const req = request(app).get(`/api/assignments/${assignmentId}/me`);
  return cookie ? req.set('Cookie', cookie) : req;
};

/** Opens an upload (or the one already open) and sends `count` images into it. Returns the version and the files' IDs. */
async function upload(assignmentId: string, who: TestUser, count = 1) {
  const opened = await openUpload(build(), assignmentId, who.cookie);
  expect(opened.status).toBeLessThan(300);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const clientFileId = `fin-${RUN}-${++fileCounter}`;
    const sent = await sendFile(build(), opened.body.id, who.cookie, PNG, {
      contentType: 'image/png',
      clientFileId,
      name: `page${i + 1}.png`,
    });
    expect(sent.status).toBe(201);
    ids.push(clientFileId);
  }
  return { versionId: opened.body.id as string, ids };
}

/** The student's submission row for an assignment. */
const submissionOf = (assignmentId: string, who: TestUser) =>
  db.submission.findUniqueOrThrow({ where: { assignmentId_studentId: { assignmentId, studentId: who.user.id } } });

describe('POST /api/versions/:id/finalize (SUB-05)', () => {
  it('stores the version, queues the submission and answers with the receipt', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 2);
    const res = await finalize(build(), versionId, student.cookie, ids);

    expect(res.status).toBe(200);
    const receipt = StudentSubmissionSchema.parse(res.body);
    expect(receipt).toMatchObject({
      state: 'GRADING',
      isLate: false,
      closed: false,
      attemptsLeft: 3,
      unlimited: false,
      draftVersion: null,
    });
    expect(receipt.files.map((file) => file.displayName)).toEqual(['page1.png', 'page2.png']);
    expect(receipt.firstSubmittedAt).not.toBeNull();
    expect(receipt.latestSubmittedAt).toBe(receipt.firstSubmittedAt);

    const submission = await submissionOf(assignment.id, student);
    expect(submission).toMatchObject({ state: 'QUEUED', currentVersionId: versionId, resubmissionsUsed: 0 });
    const version = await db.submissionVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.status).toBe('STORED');
    expect(version.storedAt).not.toBeNull();
  });

  it('gives the same answer to a second finalize and changes nothing', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const first = await finalize(build(), versionId, student.cookie, ids);
    const before = await submissionOf(assignment.id, student);

    const again = await finalize(build(), versionId, student.cookie, ids);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await submissionOf(assignment.id, student)).toEqual(before);
  });

  it('drops a stored file that is not in the list, and queues its object for deletion', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 3);
    const unlisted = await db.submissionFile.findFirstOrThrow({ where: { versionId, clientFileId: ids[2] } });

    const res = await finalize(build(), versionId, student.cookie, ids.slice(0, 2));
    expect(res.body.files).toHaveLength(2);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(2);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: unlisted.storagePath! } })).toBe(1);
  });

  it('puts the files in the order of the list, whatever order they arrived in', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 3);
    const res = await finalize(build(), versionId, student.cookie, [ids[2]!, ids[0]!, ids[1]!]);

    expect(res.body.files.map((file: { displayName: string; ordinal: number }) => [file.displayName, file.ordinal])).toEqual([
      ['page3.png', 1],
      ['page1.png', 2],
      ['page2.png', 3],
    ]);
  });

  it('is UPLOAD_INCOMPLETE for a file that was never stored, and changes nothing', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const res = await finalize(build(), versionId, student.cookie, [...ids, `never-sent-${RUN}`]);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'UPLOAD_INCOMPLETE', details: { missing: [`never-sent-${RUN}`] } });
    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: null, currentVersionId: null });
    expect((await db.submissionVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe('UPLOADING');
  });

  it('is VALIDATION for no files, for more than ten, and for a version ID that is not one', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);
    const many = Array.from({ length: 11 }, (_, i) => `many-files-${i}`);

    expect((await finalize(build(), versionId, student.cookie, [])).body.error.code).toBe('VALIDATION');
    expect((await finalize(build(), versionId, student.cookie, many)).body.error.code).toBe('VALIDATION');
    expect((await finalize(build(), 'not-a-uuid', student.cookie, ['some-file-id'])).body.error.code).toBe('VALIDATION');
  });

  it('checks the total again: FILE_LIMIT total-size when the stored files add up to over 15 MB', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 2);
    await db.submissionFile.updateMany({ where: { versionId }, data: { sizeBytes: BigInt(8 * MiB) } }); // two arriving together can both pass the check

    const res = await finalize(build(), versionId, student.cookie, ids);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'total-size' } });
  });

  it('counts the reference files toward the same 15 MB: FILE_LIMIT grading-budget', async () => {
    const assignment = await seedAssignment(cls.id);
    await db.referenceFile.create({
      data: {
        assignmentId: assignment.id,
        ordinal: 1,
        storagePath: `reference/${RUN}/${assignment.id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(6 * MiB),
        sha256: 'a'.repeat(64),
      },
    });
    const { versionId, ids } = await upload(assignment.id, student);
    await db.submissionFile.updateMany({ where: { versionId }, data: { sizeBytes: BigInt(10 * MiB) } }); // 10 on its own is fine, 16 with the reference file is not

    const res = await finalize(build(), versionId, student.cookie, ids);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'grading-budget' } });
  });

  it('is CLASS_ARCHIVED when the class was archived after the upload was opened', async () => {
    const archived = await seedClass(owner.user.id);
    const member = await enrolledStudent('late-archive', archived.id);
    const assignment = await seedAssignment(archived.id);
    const { versionId, ids } = await upload(assignment.id, member);
    await db.class.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    const res = await finalize(build(), versionId, member.cookie, ids);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_ARCHIVED');
  });

  it('is NOT_FOUND for another student, an instructor, a removed student and a missing version, and 401 signed out', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const classmate = await enrolledStudent('fin-classmate', cls.id);

    expect((await finalize(build(), versionId, classmate.cookie, ids)).body.error.code).toBe('NOT_FOUND');
    expect((await finalize(build(), versionId, owner.cookie, ids)).status).toBe(404);
    expect((await finalize(build(), randomUUID(), student.cookie, ids)).status).toBe(404);
    const signedOut = await request(build())
      .post(`/api/versions/${versionId}/finalize`)
      .set('Origin', APP_URL)
      .send({ expectedFileIds: ids });
    expect(signedOut.status).toBe(401);

    await db.enrollment.update({
      where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
      data: { status: 'REMOVED' },
    });
    try {
      expect((await finalize(build(), versionId, student.cookie, ids)).body.error.code).toBe('NOT_FOUND');
    } finally {
      await db.enrollment.update({
        where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
        data: { status: 'ACTIVE' },
      });
    }
  });
});

const removeRequest = (app: TestApp, versionId: string, clientFileId: string, cookie?: string) => {
  const req = request(app).delete(`/api/versions/${versionId}/files/${clientFileId}`).set('Origin', APP_URL);
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('DELETE /api/versions/:id/files/:clientFileId (SUB-04)', () => {
  it('removes the file and queues its object for deletion, and the other files stay', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 3);
    const gone = await db.submissionFile.findFirstOrThrow({ where: { versionId, clientFileId: ids[1] } });

    const res = await removeRequest(build(), versionId, ids[1]!, student.cookie);
    expect(res.status).toBe(204);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(2);
    expect(await db.submissionFile.count({ where: { id: gone.id } })).toBe(0);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: gone.storagePath! } })).toBe(1);

    const mine = await getMine(build(), assignment.id, student.cookie);
    expect(mine.body.draftVersion.files.map((file: { clientFileId: string }) => file.clientFileId)).toEqual([ids[0], ids[2]]);
  });

  it('answers 204 again for a file that is already gone, and queues nothing more', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 2);
    const gone = await db.submissionFile.findFirstOrThrow({ where: { versionId, clientFileId: ids[0] } });

    expect((await removeRequest(build(), versionId, ids[0]!, student.cookie)).status).toBe(204);
    expect((await removeRequest(build(), versionId, ids[0]!, student.cookie)).status).toBe(204);
    expect((await removeRequest(build(), versionId, `never-sent-${RUN}`, student.cookie)).status).toBe(204);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: gone.storagePath! } })).toBe(1);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(1);
  });

  it('gives the place back, so a full upload can take another file', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, LIMITS.filesPerSubmission);
    const full = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    expect(full.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'files' } });

    await removeRequest(build(), versionId, ids[3]!, student.cookie);
    const next = await sendFile(build(), versionId, student.cookie, PNG, { contentType: 'image/png' });
    expect(next.status).toBe(201);
    expect(next.body.ordinal).toBe(4);
  }, 60_000); // eleven file requests to the hosted test database

  it('is UPLOAD_NOT_OPEN once the version is stored, and the files stay', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    await finalize(build(), versionId, student.cookie, ids);

    const res = await removeRequest(build(), versionId, ids[0]!, student.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UPLOAD_NOT_OPEN');
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(1);
  });

  it('is NOT_FOUND for another student, an instructor, a removed student and a missing version, and 401 signed out', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const classmate = await enrolledStudent('del-classmate', cls.id);

    expect((await removeRequest(build(), versionId, ids[0]!, classmate.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await removeRequest(build(), versionId, ids[0]!, owner.cookie)).status).toBe(404);
    expect((await removeRequest(build(), randomUUID(), ids[0]!, student.cookie)).status).toBe(404);
    expect((await removeRequest(build(), versionId, ids[0]!)).status).toBe(401);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(1); // nobody but the owner removed anything

    await db.enrollment.update({
      where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
      data: { status: 'REMOVED' },
    });
    try {
      expect((await removeRequest(build(), versionId, ids[0]!, student.cookie)).body.error.code).toBe('NOT_FOUND');
    } finally {
      await db.enrollment.update({
        where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('is VALIDATION for a clientFileId that is too short', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);
    expect((await removeRequest(build(), versionId, 'short', student.cookie)).body.error.code).toBe('VALIDATION');
  });
});

const cancelRequest = (app: TestApp, versionId: string, cookie?: string) => {
  const req = request(app).delete(`/api/versions/${versionId}`).set('Origin', APP_URL);
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('DELETE /api/versions/:id (SUB-06)', () => {
  it('deletes an open first upload with its files, queues the objects, and the student is NOT_SUBMITTED again', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student, 2);
    const files = await db.submissionFile.findMany({ where: { versionId } });

    const res = await cancelRequest(build(), versionId, student.cookie);
    expect(res.status).toBe(204);
    expect(await db.submissionVersion.count({ where: { id: versionId } })).toBe(0);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(0);
    for (const file of files) expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: file.storagePath! } })).toBe(1);
    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: null, currentVersionId: null }); // the row stays
    expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({ state: 'NOT_SUBMITTED', draftVersion: null });
    expect((await openUpload(build(), assignment.id, student.cookie)).status).toBe(201); // a new upload can be opened
  });

  it('cancels a resubmission and leaves the earlier submission, its files, its grade and its attempts alone', async () => {
    const assignment = await seedAssignment(cls.id);
    const first = await upload(assignment.id, student, 2);
    await finalize(build(), first.versionId, student.cookie, first.ids);
    const kept = await db.submissionFile.findMany({ where: { versionId: first.versionId } });
    const before = await submissionOf(assignment.id, student);

    const second = await upload(assignment.id, student);
    const added = await db.submissionFile.findFirstOrThrow({ where: { versionId: second.versionId } });
    expect((await cancelRequest(build(), second.versionId, student.cookie)).status).toBe(204);

    expect(await db.submissionVersion.count({ where: { id: second.versionId } })).toBe(0);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: added.storagePath! } })).toBe(1);
    // The first version is still the current one: its files stay stored and none of them was queued for deletion.
    expect(await submissionOf(assignment.id, student)).toMatchObject({
      state: before.state,
      currentVersionId: first.versionId,
      resubmissionsUsed: 0,
    });
    expect(await db.submissionFile.count({ where: { versionId: first.versionId } })).toBe(2);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: { in: kept.map((file) => file.storagePath!) } } })).toBe(
      0,
    );
    expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({
      state: 'GRADING',
      attemptsLeft: 3,
      draftVersion: null,
    });
  });

  it('is UPLOAD_NOT_OPEN for a stored version and for a replaced one, and nothing is deleted', async () => {
    const assignment = await seedAssignment(cls.id);
    const first = await upload(assignment.id, student);
    await finalize(build(), first.versionId, student.cookie, first.ids);

    const stored = await cancelRequest(build(), first.versionId, student.cookie);
    expect(stored.status).toBe(409);
    expect(stored.body.error.code).toBe('UPLOAD_NOT_OPEN');
    expect(await db.submissionFile.count({ where: { versionId: first.versionId } })).toBe(1);

    const second = await upload(assignment.id, student);
    await finalize(build(), second.versionId, student.cookie, second.ids); // the first version is replaced now
    expect((await cancelRequest(build(), first.versionId, student.cookie)).body.error.code).toBe('UPLOAD_NOT_OPEN');
    expect((await cancelRequest(build(), second.versionId, student.cookie)).body.error.code).toBe('UPLOAD_NOT_OPEN');
    expect(await db.submissionFile.count({ where: { versionId: second.versionId } })).toBe(1);
  });

  it('answers 204 for a cancel and NOT_FOUND for the same cancel sent again', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);

    expect((await cancelRequest(build(), versionId, student.cookie)).status).toBe(204);
    expect((await cancelRequest(build(), versionId, student.cookie)).body.error.code).toBe('NOT_FOUND');
  });

  it('gives 204 to one of two cancels at the same moment and never an error, and queues each object once', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student, 2);
    const files = await db.submissionFile.findMany({ where: { versionId } });
    const app = build();

    const [a, b] = await Promise.all([cancelRequest(app, versionId, student.cookie), cancelRequest(app, versionId, student.cookie)]);
    // The second is 204 if it was waiting on the lock when the first finished, and NOT_FOUND if it started after.
    expect([a.status, b.status].sort()).toSatisfy((statuses: number[]) => statuses[0] === 204 && [204, 404].includes(statuses[1]!));
    expect(await db.submissionVersion.count({ where: { id: versionId } })).toBe(0);
    for (const file of files) expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: file.storagePath! } })).toBe(1);
  });

  it('runs a cancel and a finalize at the same moment one after the other: one wins, the other is refused, never a 500', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const app = build();

    const [cancelled, finalized] = await Promise.all([
      cancelRequest(app, versionId, student.cookie),
      finalize(app, versionId, student.cookie, ids),
    ]);

    const versions = await db.submissionVersion.count({ where: { id: versionId } });
    if (cancelled.status === 204) {
      expect(finalized.status).toBe(404); // the version was gone when finalize looked
      expect(versions).toBe(0);
      expect((await submissionOf(assignment.id, student)).state).toBeNull();
    } else {
      expect([cancelled.status, cancelled.body.error.code, finalized.status]).toEqual([409, 'UPLOAD_NOT_OPEN', 200]); // finalize got there first
      expect(versions).toBe(1);
      expect((await submissionOf(assignment.id, student)).currentVersionId).toBe(versionId);
    }
  });

  it('answers a file removal that arrives after the cancel with NOT_FOUND, not a 500', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const app = build();

    const [cancelled, removed] = await Promise.all([
      cancelRequest(app, versionId, student.cookie),
      removeRequest(app, versionId, ids[0]!, student.cookie),
    ]);
    expect(cancelled.status).toBe(204);
    expect([204, 404]).toContain(removed.status); // 204 if the removal won the lock, NOT_FOUND if the cancel did
  });

  it('is NOT_FOUND for another student, an instructor, a removed student and a missing version, and 401 signed out', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);
    const classmate = await enrolledStudent('cancel-classmate', cls.id);

    expect((await cancelRequest(build(), versionId, classmate.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await cancelRequest(build(), versionId, owner.cookie)).status).toBe(404);
    expect((await cancelRequest(build(), randomUUID(), student.cookie)).status).toBe(404);
    expect((await cancelRequest(build(), versionId)).status).toBe(401);
    expect(await db.submissionVersion.count({ where: { id: versionId } })).toBe(1); // nobody but the owner cancelled anything

    await db.enrollment.update({
      where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
      data: { status: 'REMOVED' },
    });
    try {
      expect((await cancelRequest(build(), versionId, student.cookie)).body.error.code).toBe('NOT_FOUND');
    } finally {
      await db.enrollment.update({
        where: { classId_studentId: { classId: cls.id, studentId: student.user.id } },
        data: { status: 'ACTIVE' },
      });
    }
    expect(await db.submissionVersion.count({ where: { id: versionId } })).toBe(1);
  });

  it('is VALIDATION for a version id that is not a UUID', async () => {
    expect((await cancelRequest(build(), 'not-a-uuid', student.cookie)).body.error.code).toBe('VALIDATION');
  });
});

describe('deleteStagedUploads (SUB-04)', () => {
  /** Makes the upload look as old as `hours`. */
  const ageUpload = (versionId: string, hours: number) =>
    db.submissionVersion.update({ where: { id: versionId }, data: { createdAt: new Date(Date.now() - hours * 60 * 60 * 1000) } });

  it('deletes an upload opened more than 24 hours ago with its files, queues the objects, and keeps the submission', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student, 2);
    const files = await db.submissionFile.findMany({ where: { versionId } });
    await ageUpload(versionId, 25);

    expect(await deleteStagedUploads(db, BUCKET)).toBeGreaterThanOrEqual(1);
    expect(await db.submissionVersion.count({ where: { id: versionId } })).toBe(0);
    expect(await db.submissionFile.count({ where: { versionId } })).toBe(0);
    for (const file of files) expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: file.storagePath! } })).toBe(1);
    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: null, currentVersionId: null });
    expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({ state: 'NOT_SUBMITTED', draftVersion: null });
  });

  it('leaves an upload that is under 24 hours old, and a stored version however old', async () => {
    const recent = await seedAssignment(cls.id);
    const open = await upload(recent.id, student);
    await ageUpload(open.versionId, 23);

    const finished = await seedAssignment(cls.id);
    const stored = await upload(finished.id, student);
    await finalize(build(), stored.versionId, student.cookie, stored.ids);
    await ageUpload(stored.versionId, 48);

    await deleteStagedUploads(db, BUCKET);
    expect((await db.submissionVersion.findUniqueOrThrow({ where: { id: open.versionId } })).status).toBe('UPLOADING');
    expect(await db.submissionFile.count({ where: { versionId: open.versionId } })).toBe(1);
    expect((await db.submissionVersion.findUniqueOrThrow({ where: { id: stored.versionId } })).status).toBe('STORED');
    expect(await db.submissionFile.count({ where: { versionId: stored.versionId } })).toBe(1);
  });

  it('lets the student open a new upload afterwards', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);
    await ageUpload(versionId, 30);
    await deleteStagedUploads(db, BUCKET);

    const res = await openUpload(build(), assignment.id, student.cookie);
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(versionId);
  });
});

describe('resubmitting through finalize (SUB-05)', () => {
  /** A submitted first version, so the next upload is a resubmission. */
  async function submitted(overrides: Partial<Prisma.AssignmentUncheckedCreateInput> = {}) {
    const assignment = await seedAssignment(cls.id, overrides);
    const first = await upload(assignment.id, student, 2);
    expect((await finalize(build(), first.versionId, student.cookie, first.ids)).status).toBe(200);
    return { assignment, first };
  }

  it('replaces the first version, uses one attempt and queues again', async () => {
    const { assignment, first } = await submitted();
    const before = await submissionOf(assignment.id, student);
    const oldPaths = (await db.submissionFile.findMany({ where: { versionId: first.versionId } })).map((file) => file.storagePath!);

    const second = await upload(assignment.id, student);
    const res = await finalize(build(), second.versionId, student.cookie, second.ids);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'GRADING', attemptsLeft: 2, draftVersion: null });
    expect(res.body.files).toHaveLength(1);
    const after = await submissionOf(assignment.id, student);
    expect(after).toMatchObject({ state: 'QUEUED', currentVersionId: second.versionId, resubmissionsUsed: 1 });
    expect(after.firstSubmittedAt).toEqual(before.firstSubmittedAt);
    expect(after.latestSubmittedAt!.getTime()).toBeGreaterThan(before.latestSubmittedAt!.getTime());
    expect((await db.submissionVersion.findUniqueOrThrow({ where: { id: first.versionId } })).status).toBe('REPLACED');
    expect(await db.submissionFile.count({ where: { versionId: first.versionId } })).toBe(0);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: { in: oldPaths } } })).toBe(2);
  });

  it('starts again after manual review, clearing the cause', async () => {
    const { assignment } = await submitted();
    await db.submission.updateMany({
      where: { assignmentId: assignment.id, studentId: student.user.id },
      data: { state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'AI_FAILED' },
    });

    const second = await upload(assignment.id, student);
    expect((await finalize(build(), second.versionId, student.cookie, second.ids)).status).toBe(200);
    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: 'QUEUED', manualReviewCause: null });
  });

  it('gives one attempt to two finalizes at the same moment', async () => {
    const { assignment } = await submitted();
    const second = await upload(assignment.id, student);
    const app = build();
    const [a, b] = await Promise.all([
      finalize(app, second.versionId, student.cookie, second.ids),
      finalize(app, second.versionId, student.cookie, second.ids),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect((await submissionOf(assignment.id, student)).resubmissionsUsed).toBe(1);
  });

  it('is ATTEMPTS_EXHAUSTED when opening another upload with none left, and makes no new version', async () => {
    const { assignment } = await submitted({ maxResubmissions: 0 });
    const res = await openUpload(build(), assignment.id, student.cookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ATTEMPTS_EXHAUSTED');
    expect(await db.submissionVersion.count({ where: { submission: { assignmentId: assignment.id } } })).toBe(1);
  });

  it('is ATTEMPTS_EXHAUSTED at finalize too, when the last attempt went elsewhere after the upload opened', async () => {
    const { assignment, first } = await submitted({ maxResubmissions: 1 });
    const second = await upload(assignment.id, student);
    await db.submission.updateMany({ where: { assignmentId: assignment.id, studentId: student.user.id }, data: { resubmissionsUsed: 1 } });

    const res = await finalize(build(), second.versionId, student.cookie, second.ids);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ATTEMPTS_EXHAUSTED');
    expect((await submissionOf(assignment.id, student)).currentVersionId).toBe(first.versionId);
  });

  it('counts the extra attempts an instructor gave', async () => {
    const { assignment } = await submitted({ maxResubmissions: 0 });
    await db.submission.updateMany({ where: { assignmentId: assignment.id, studentId: student.user.id }, data: { extraAttempts: 1 } });

    const second = await upload(assignment.id, student);
    const res = await finalize(build(), second.versionId, student.cookie, second.ids);
    expect(res.body).toMatchObject({ state: 'GRADING', attemptsLeft: 0 });
    expect((await openUpload(build(), assignment.id, student.cookie)).body.error.code).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('never runs out when resubmissions are unlimited', async () => {
    const { assignment } = await submitted({ maxResubmissions: null });
    const second = await upload(assignment.id, student);
    const res = await finalize(build(), second.versionId, student.cookie, second.ids);

    expect(res.body).toMatchObject({ attemptsLeft: null, unlimited: true });
    expect((await openUpload(build(), assignment.id, student.cookie)).status).toBe(201);
  });
});

describe('finalize starts grading (AI-08)', () => {
  const jobsFor = (submissionId: string) => sent.filter((job) => job.submissionId === submissionId);

  it('sends one job for a first submission, after the version is stored', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    let statusWhenSent: string | undefined;
    sender = async (job) => {
      statusWhenSent = (await db.submissionVersion.findUniqueOrThrow({ where: { id: job.versionId } })).status;
      await recordJobs(job);
    };

    expect((await finalize(build(), versionId, student.cookie, ids)).status).toBe(200);

    const submission = await submissionOf(assignment.id, student);
    expect(jobsFor(submission.id)).toEqual([{ submissionId: submission.id, versionId, mode: 'first' }]);
    expect(statusWhenSent).toBe('STORED'); // sent after the commit, so the worker finds the version
  });

  it('sends nothing for a repeat finalize, or for two at the same moment', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student);
    const app = build();
    await Promise.all([finalize(app, versionId, student.cookie, ids), finalize(app, versionId, student.cookie, ids)]);
    await finalize(app, versionId, student.cookie, ids);

    expect(jobsFor((await submissionOf(assignment.id, student)).id)).toHaveLength(1);
  });

  it('sends nothing when finalize is refused', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);

    const res = await finalize(build(), versionId, student.cookie, ['never-sent']);

    expect(res.body.error.code).toBe('UPLOAD_INCOMPLETE');
    expect(jobsFor((await submissionOf(assignment.id, student)).id)).toHaveLength(0);
  });

  it('sends a resubmit job and clears the active grade of the old version', async () => {
    const assignment = await seedAssignment(cls.id);
    const first = await upload(assignment.id, student);
    await finalize(build(), first.versionId, student.cookie, first.ids);
    const submission = await submissionOf(assignment.id, student);
    const grade = await db.gradeResult.create({
      data: {
        submissionId: submission.id,
        versionId: first.versionId,
        source: 'AI',
        status: 'ACTIVE',
        score: 80,
        feedback: 'Good.',
        criteriaVersion: 1,
        model: 'fake',
        promptVersion: 'grade-v1',
        confidence: 'high',
      },
    });
    await db.submission.update({ where: { id: submission.id }, data: { activeGradeId: grade.id, state: 'AI_GENERATED' } });

    const second = await upload(assignment.id, student);
    expect((await finalize(build(), second.versionId, student.cookie, second.ids)).status).toBe(200);

    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: 'QUEUED', activeGradeId: null });
    expect(jobsFor(submission.id)).toEqual([
      { submissionId: submission.id, versionId: first.versionId, mode: 'first' },
      { submissionId: submission.id, versionId: second.versionId, mode: 'resubmit' },
    ]);
  });
});

describe('late work (SUB-06)', () => {
  const yesterday = () => new Date(Date.now() - DAY_MS);
  /** Moves the due date into the past, as if the time had passed. */
  const makePastDue = (assignmentId: string) => db.assignment.update({ where: { id: assignmentId }, data: { dueAt: yesterday() } });

  it('is LATE_CLOSED when opening after the due date with late work closed, and makes no submission', async () => {
    const assignment = await seedAssignment(cls.id, { dueAt: yesterday(), acceptLate: false });
    const res = await openUpload(build(), assignment.id, student.cookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LATE_CLOSED');
    expect(await db.submission.count({ where: { assignmentId: assignment.id } })).toBe(0);
  });

  it('accepts late work when late is accepted, and shows Late', async () => {
    const assignment = await seedAssignment(cls.id, { dueAt: yesterday(), acceptLate: true });
    const { versionId, ids } = await upload(assignment.id, student);
    const res = await finalize(build(), versionId, student.cookie, ids);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'GRADING', isLate: true, closed: false });
    expect((await submissionOf(assignment.id, student)).latestSubmittedAt).not.toBeNull();
  });

  it('follows the latest submission time: on time at first, Late after a late resubmission, with both times kept', async () => {
    const assignment = await seedAssignment(cls.id, { acceptLate: true });
    const first = await upload(assignment.id, student);
    await finalize(build(), first.versionId, student.cookie, first.ids);
    // The time passes: the first submission was two days ago, and the due date was yesterday.
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
    await db.submission.updateMany({
      where: { assignmentId: assignment.id, studentId: student.user.id },
      data: { firstSubmittedAt: twoDaysAgo, latestSubmittedAt: twoDaysAgo },
    });
    await makePastDue(assignment.id);
    expect((await getMine(build(), assignment.id, student.cookie)).body.isLate).toBe(false);

    const second = await upload(assignment.id, student);
    const res = await finalize(build(), second.versionId, student.cookie, second.ids);
    expect(res.status).toBe(200);
    expect(res.body.isLate).toBe(true);
    expect(res.body.firstSubmittedAt).toBe(twoDaysAgo.toISOString());
    expect(new Date(res.body.latestSubmittedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('lets a student in when the instructor allowed them, for open and finalize', async () => {
    const assignment = await seedAssignment(cls.id, { dueAt: yesterday(), acceptLate: false });
    await db.submission.create({ data: { assignmentId: assignment.id, studentId: student.user.id, lateAllowed: true } });
    const { versionId, ids } = await upload(assignment.id, student);
    const res = await finalize(build(), versionId, student.cookie, ids);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'GRADING', isLate: true, closed: false });
  });

  it('refuses a resubmission once the due date has passed and late work is closed, and makes no new version', async () => {
    const assignment = await seedAssignment(cls.id, { acceptLate: false });
    const first = await upload(assignment.id, student);
    expect((await finalize(build(), first.versionId, student.cookie, first.ids)).status).toBe(200);
    await makePastDue(assignment.id);

    const res = await openUpload(build(), assignment.id, student.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LATE_CLOSED');
    expect(await db.submissionVersion.count({ where: { submission: { assignmentId: assignment.id } } })).toBe(1);
  });

  it('stops an upload that was open when the due date passed: open and finalize both refuse, and nothing changes', async () => {
    const assignment = await seedAssignment(cls.id, { acceptLate: false });
    const { versionId, ids } = await upload(assignment.id, student);
    await makePastDue(assignment.id);

    expect((await openUpload(build(), assignment.id, student.cookie)).body.error.code).toBe('LATE_CLOSED');
    const res = await finalize(build(), versionId, student.cookie, ids);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LATE_CLOSED');
    expect((await db.submissionVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe('UPLOADING');
    expect(await submissionOf(assignment.id, student)).toMatchObject({ state: null, currentVersionId: null });
  });

  it('still answers a repeated finalize of a stored version after the due date', async () => {
    const assignment = await seedAssignment(cls.id, { acceptLate: false });
    const { versionId, ids } = await upload(assignment.id, student);
    const first = await finalize(build(), versionId, student.cookie, ids);
    await makePastDue(assignment.id);

    const again = await finalize(build(), versionId, student.cookie, ids);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: 'GRADING', closed: true });
    expect(again.body.latestSubmittedAt).toBe(first.body.latestSubmittedAt);
  });

  it('checks the class first: a pending student gets ENROLLMENT_PENDING, an instructor and a stranger NOT_FOUND', async () => {
    const assignment = await seedAssignment(cls.id, { dueAt: yesterday(), acceptLate: false });
    const pending = await enrolledStudent('late-pending', cls.id, 'PENDING');
    const stranger = await signedInUser('late-stranger', 'STUDENT');

    expect((await openUpload(build(), assignment.id, pending.cookie)).body.error.code).toBe('ENROLLMENT_PENDING');
    expect((await openUpload(build(), assignment.id, owner.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await openUpload(build(), assignment.id, stranger.cookie)).body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/assignments/:id/me (SUB-01)', () => {
  it('is NOT_SUBMITTED before anything is done', async () => {
    const assignment = await seedAssignment(cls.id);
    const res = await getMine(build(), assignment.id, student.cookie);

    expect(res.status).toBe(200);
    expect(StudentSubmissionSchema.parse(res.body)).toEqual({
      state: 'NOT_SUBMITTED',
      isLate: false,
      closed: false,
      attemptsLeft: 3,
      unlimited: false,
      firstSubmittedAt: null,
      latestSubmittedAt: null,
      files: [],
      grade: null,
      instructorComment: null,
      draftVersion: null,
    });
  });

  it('is UPLOADING with the open version while nothing is stored yet', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId } = await upload(assignment.id, student);
    const res = await getMine(build(), assignment.id, student.cookie);

    expect(res.body).toMatchObject({ state: 'UPLOADING', files: [], draftVersion: { id: versionId, status: 'UPLOADING' } });
  });

  it('lists the files stored in the open upload, in order, so the page can pick it up after a reload', async () => {
    const assignment = await seedAssignment(cls.id);
    const { ids } = await upload(assignment.id, student, 2);
    const res = await getMine(build(), assignment.id, student.cookie);

    const draft = StudentSubmissionSchema.parse(res.body).draftVersion!;
    expect(draft.files.map((file) => [file.clientFileId, file.displayName, file.status])).toEqual([
      [ids[0], 'page1.png', 'STORED'],
      [ids[1], 'page2.png', 'STORED'],
    ]);
    expect(res.body.files).toEqual([]); // nothing is submitted yet
  });

  it('shows the receipt after a submit, and keeps the state while a resubmission is open', async () => {
    const assignment = await seedAssignment(cls.id);
    const { versionId, ids } = await upload(assignment.id, student, 2);
    const answer = await finalize(build(), versionId, student.cookie, ids);

    const res = await getMine(build(), assignment.id, student.cookie);
    expect(res.body).toEqual(answer.body);
    expect(res.body).toMatchObject({ state: 'GRADING', draftVersion: null });

    const next = await openUpload(build(), assignment.id, student.cookie);
    const during = await getMine(build(), assignment.id, student.cookie);
    expect(during.body).toMatchObject({ state: 'GRADING', draftVersion: { id: next.body.id } });
    expect(during.body.files).toHaveLength(2);
  });

  it('shows Late after the due date, and closed when late work is not accepted and nobody allowed it', async () => {
    const yesterday = new Date(Date.now() - DAY_MS);
    const lateOk = await seedAssignment(cls.id, { dueAt: yesterday });
    const { versionId, ids } = await upload(lateOk.id, student);
    await finalize(build(), versionId, student.cookie, ids);
    expect((await getMine(build(), lateOk.id, student.cookie)).body).toMatchObject({ isLate: true, closed: false });

    const closed = await seedAssignment(cls.id, { dueAt: yesterday, acceptLate: false });
    expect((await getMine(build(), closed.id, student.cookie)).body).toMatchObject({ isLate: false, closed: true });
    await db.submission.create({ data: { assignmentId: closed.id, studentId: student.user.id, lateAllowed: true } });
    expect((await getMine(build(), closed.id, student.cookie)).body.closed).toBe(false);
  });

  describe('the result (AI-11)', () => {
    /** A submitted assignment whose grading has finished as the worker leaves it: the active AI grade, and the state `state`. */
    async function graded(
      state: 'QUEUED' | 'GRADING' | 'AI_GENERATED' | 'NEEDS_MANUAL_REVIEW' | 'INSTRUCTOR_APPROVED',
      overrides: Partial<Prisma.AssignmentUncheckedCreateInput> = {},
    ) {
      const assignment = await seedAssignment(cls.id, overrides);
      const { versionId, ids } = await upload(assignment.id, student);
      await finalize(build(), versionId, student.cookie, ids);
      const submission = await submissionOf(assignment.id, student);
      const grade = await db.gradeResult.create({
        data: {
          submissionId: submission.id,
          versionId,
          source: 'AI',
          status: 'ACTIVE',
          score: 42.5,
          feedback: 'Clear thesis.\nCite a source.',
          criteriaVersion: 1,
          model: 'fake',
          promptVersion: 'grade-v1',
          confidence: 'high',
          readabilityIssue: true,
        },
      });
      await db.submission.update({
        where: { id: submission.id },
        data: {
          state,
          activeGradeId: state === 'NEEDS_MANUAL_REVIEW' ? null : grade.id,
          manualReviewCause: state === 'NEEDS_MANUAL_REVIEW' ? 'AI_FAILED' : null,
          approvedAt: state === 'INSTRUCTOR_APPROVED' ? new Date() : null,
          instructorComment: 'See me after class.',
        },
      });
      return assignment;
    }

    it('gives the score, the feedback and the AI chip while the result is AI-generated, and nothing else about the grade', async () => {
      const assignment = await graded('AI_GENERATED');
      const res = await getMine(build(), assignment.id, student.cookie);

      expect(StudentSubmissionSchema.parse(res.body)).toMatchObject({
        state: 'AI_GENERATED',
        grade: {
          source: 'AI',
          score: 42.5,
          maxScore: 100,
          scoringFormat: 'POINTS',
          letter: null,
          percentage: 43,
          feedback: 'Clear thesis.\nCite a source.',
          chip: 'status-ai',
        },
        instructorComment: null, // only an approved grade carries the instructor's comment
      });
      expect(Object.keys(res.body.grade).sort()).toEqual([
        'chip',
        'feedback',
        'letter',
        'maxScore',
        'percentage',
        'score',
        'scoringFormat',
        'source',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/promptVersion|confidence|readability|model|manualReviewCause/);
    });

    it('gives the approved chip and the instructor comment once the grade is approved', async () => {
      const assignment = await graded('INSTRUCTOR_APPROVED');
      const res = await getMine(build(), assignment.id, student.cookie);

      expect(res.body).toMatchObject({
        state: 'INSTRUCTOR_APPROVED',
        grade: { chip: 'status-approved' },
        instructorComment: 'See me after class.',
      });
    });

    it('rounds the percentage to a whole number, from the assignment maximum', async () => {
      const assignment = await graded('AI_GENERATED', { scoringFormat: 'PERCENTAGE', maxScore: 100 });
      expect((await getMine(build(), assignment.id, student.cookie)).body.grade).toMatchObject({
        scoringFormat: 'PERCENTAGE',
        score: 42.5,
        percentage: 43,
      });
    });

    it.each(['QUEUED', 'GRADING'] as const)('has no grade while the state is %s, even if an old one is still stored', async (state) => {
      const assignment = await graded(state);
      expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({
        state: 'GRADING',
        grade: null,
        instructorComment: null,
      });
    });

    it('is awaiting review with no grade and no cause when the submission needs manual review', async () => {
      const assignment = await graded('NEEDS_MANUAL_REVIEW');
      const res = await getMine(build(), assignment.id, student.cookie);

      expect(res.body).toMatchObject({ state: 'AWAITING_REVIEW', grade: null, instructorComment: null });
      expect(JSON.stringify(res.body)).not.toMatch(/AI_FAILED|manualReviewCause/);
    });

    it('drops the old grade when the student resubmits', async () => {
      const assignment = await graded('AI_GENERATED');
      const second = await upload(assignment.id, student);
      await finalize(build(), second.versionId, student.cookie, second.ids);

      expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({ state: 'GRADING', grade: null });
    });

    it("never shows one student's grade to another", async () => {
      const assignment = await graded('AI_GENERATED');
      const other = await enrolledStudent('me-other-student', cls.id, 'ACTIVE');

      expect((await getMine(build(), assignment.id, other.cookie)).body).toMatchObject({ state: 'NOT_SUBMITTED', grade: null });
    });
  });

  it('says Unlimited when the assignment has no resubmission limit', async () => {
    const assignment = await seedAssignment(cls.id, { maxResubmissions: null });
    expect((await getMine(build(), assignment.id, student.cookie)).body).toMatchObject({ attemptsLeft: null, unlimited: true });
  });

  it('is NOT_FOUND for a draft, a missing assignment, an instructor and outsiders, ENROLLMENT_PENDING for a pending student, and 401 signed out', async () => {
    const draft = await seedAssignment(cls.id, { status: 'DRAFT', publishedAt: null });
    const published = await seedAssignment(cls.id);
    const pending = await enrolledStudent('me-pending', cls.id, 'PENDING');
    const declined = await enrolledStudent('me-declined', cls.id, 'DECLINED');
    const outsider = await signedInUser('me-outsider', 'STUDENT');

    expect((await getMine(build(), draft.id, student.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await getMine(build(), randomUUID(), student.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await getMine(build(), published.id, owner.cookie)).status).toBe(404);
    expect((await getMine(build(), published.id, pending.cookie)).body.error.code).toBe('ENROLLMENT_PENDING');
    for (const who of [declined, outsider]) expect((await getMine(build(), published.id, who.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await getMine(build(), published.id)).status).toBe(401);
  });
});

describe('reference files (API Spec REF-01 to REF-04)', () => {
  const draft = (classId = cls.id) => seedAssignment(classId, { status: 'DRAFT', publishedAt: null });

  /** The instructor's form: the file in a form, as the browser sends it. */
  const addReference = (assignmentId: string, cookie: string | undefined, body: Buffer, name = 'rubric.pdf', type = 'application/pdf') => {
    const req = request(build()).post(`/api/assignments/${assignmentId}/reference-files`).set('Origin', APP_URL);
    if (cookie) req.set('Cookie', cookie);
    return req.attach('file', body, { filename: name, contentType: type });
  };
  const patchReference = (fileId: string, cookie: string | undefined, body: object) => {
    const req = request(build()).patch(`/api/reference-files/${fileId}`).set('Origin', APP_URL);
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const deleteReference = (fileId: string, cookie?: string) => {
    const req = request(build()).delete(`/api/reference-files/${fileId}`).set('Origin', APP_URL);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const linkTo = (fileId: string, cookie?: string) => {
    const req = request(build()).get(`/api/reference-files/${fileId}/url`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const rowsOf = (assignmentId: string) => db.referenceFile.findMany({ where: { assignmentId }, orderBy: { ordinal: 'asc' } });
  const objectsStored = async () => storage.count();
  const readBy = (assignmentId: string, cookie: string) => request(build()).get(`/api/assignments/${assignmentId}`).set('Cookie', cookie);
  const publish = (assignmentId: string) =>
    db.assignment.update({ where: { id: assignmentId }, data: { status: 'PUBLISHED', publishedAt: new Date() } });

  let other: TestUser;
  let admin: TestUser;
  beforeAll(async () => {
    other = await signedInUser('ref-other', 'INSTRUCTOR');
    admin = await signedInUser('ref-admin', 'SUPER_ADMIN');
  });

  it('adds a PDF, a JPEG and a PNG to a draft with no token, each in the next place, stored and with its hash', async () => {
    const assignment = await draft();
    const files = [
      { body: PDF, name: 'a.pdf', type: 'application/pdf' },
      { body: JPEG, name: 'b.jpg', type: 'image/jpeg' },
      { body: PNG, name: 'c.png', type: 'image/png' },
    ];

    for (const [index, file] of files.entries()) {
      const res = await addReference(assignment.id, owner.cookie, file.body, file.name, file.type).field(
        'impactToken',
        'ignored on a draft',
      );
      expect(res.status, file.name).toBe(201);
      expect(ReferenceFileViewSchema.parse(res.body)).toEqual({
        id: expect.any(String),
        ordinal: index + 1,
        label: `Reference file ${index + 1}`,
        mimeType: file.type,
        sizeBytes: file.body.length,
        visibleToStudents: false, // off until the instructor turns it on
      });
    }

    const rows = await rowsOf(assignment.id);
    expect(rows.map((row) => row.mimeType)).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
    for (const [index, row] of rows.entries()) {
      expect(await storage.exists(BUCKET, row.storagePath)).toBe(true);
      expect(row.sha256).toBe(createHash('sha256').update(files[index]!.body).digest('hex'));
      expect(row.storagePath).toMatch(new RegExp(`^reference/${cls.id}/${assignment.id}/[0-9a-f-]{36}\\.(pdf|jpg|png)$`)); // built from IDs, never the name
    }
  });

  it('refuses a fourth file with FILE_LIMIT reference-count and stores nothing more', async () => {
    const assignment = await draft();
    for (const name of ['1.pdf', '2.pdf', '3.pdf']) expect((await addReference(assignment.id, owner.cookie, PDF, name)).status).toBe(201);
    const before = await objectsStored();

    const res = await addReference(assignment.id, owner.cookie, PDF, '4.pdf');

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'reference-count' } });
    expect(await rowsOf(assignment.id)).toHaveLength(3);
    expect(await objectsStored()).toBe(before);
  });

  it('gives a removed file’s place to the next one, and leaves the other places alone', async () => {
    const assignment = await draft();
    const ids: string[] = [];
    for (const name of ['1.pdf', '2.pdf', '3.pdf']) ids.push((await addReference(assignment.id, owner.cookie, PDF, name)).body.id);

    expect((await deleteReference(ids[1]!, owner.cookie)).status).toBe(204);
    expect((await rowsOf(assignment.id)).map((row) => row.ordinal)).toEqual([1, 3]);

    const again = await addReference(assignment.id, owner.cookie, PNG, 'again.png', 'image/png');
    expect(again.body.ordinal).toBe(2);
  });

  it('removing a file queues its object for deletion, and the row is gone', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);
    const [row] = await rowsOf(assignment.id);

    expect((await deleteReference(added.body.id, owner.cookie)).status).toBe(204);

    expect(await rowsOf(assignment.id)).toHaveLength(0);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: row!.storagePath, completedAt: null } })).toBe(1);
  });

  it('judges the file by its content: text called .pdf, an empty file and a PDF that cannot be read are refused, and nothing is stored', async () => {
    const assignment = await draft();
    const before = await objectsStored();

    const text = await addReference(assignment.id, owner.cookie, Buffer.from('just some text'), 'essay.pdf');
    expect([text.status, text.body.error.code]).toEqual([415, 'FILE_TYPE']);
    const empty = await addReference(assignment.id, owner.cookie, Buffer.alloc(0), 'empty.pdf');
    expect([empty.status, empty.body.error.code]).toEqual([415, 'FILE_TYPE']);
    const encrypted = await addReference(assignment.id, owner.cookie, ENCRYPTED_PDF, 'locked.pdf');
    expect(encrypted.body.error).toMatchObject({ code: 'FILE_ERROR', details: { failureCode: 'PASSWORD' } });
    const broken = await addReference(
      assignment.id,
      owner.cookie,
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('not a real pdf')]),
      'broken.pdf',
    );
    expect(broken.body.error).toMatchObject({ code: 'FILE_ERROR', details: { failureCode: 'CORRUPT' } });
    const long = await addReference(assignment.id, owner.cookie, await makePdf(LIMITS.maxPdfPages + 1), 'long.pdf');
    expect(long.body.error).toMatchObject({ code: 'FILE_LIMIT', details: { limit: 'pages' } });

    expect(await rowsOf(assignment.id)).toHaveLength(0);
    expect(await objectsStored()).toBe(before);
  });

  it('refuses a file over 10 MiB with FILE_TOO_LARGE and stores nothing, and takes one of exactly 10 MiB', async () => {
    const assignment = await draft();
    const before = await objectsStored();

    const over = await addReference(assignment.id, owner.cookie, pngOfSize(LIMITS.maxFileBytes + 1), 'big.png', 'image/png');
    expect([over.status, over.body.error.code]).toEqual([413, 'FILE_TOO_LARGE']);
    expect(await rowsOf(assignment.id)).toHaveLength(0);
    expect(await objectsStored()).toBe(before);

    const exact = await addReference(assignment.id, owner.cookie, pngOfSize(LIMITS.maxFileBytes), 'edge.png', 'image/png');
    expect(exact.status).toBe(201);
  });

  it('wants a form with a file in a field called file', async () => {
    const assignment = await draft();
    const url = `/api/assignments/${assignment.id}/reference-files`;
    const post = () => request(build()).post(url).set('Origin', APP_URL).set('Cookie', owner.cookie);

    const json = await post().send({ file: 'x' });
    expect([json.status, json.body.error.code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    const wrongName = await post().attach('upload', PDF, 'a.pdf');
    expect([wrongName.status, wrongName.body.error.code]).toEqual([400, 'VALIDATION']);
    const noFile = await post().field('impactToken', 'x');
    expect([noFile.status, noFile.body.error.code]).toEqual([400, 'VALIDATION']);
    expect(await rowsOf(assignment.id)).toHaveLength(0);
  });

  it('gives two adds at the same moment different places, and four at once leave exactly three files and objects', async () => {
    const assignment = await draft();
    const before = await objectsStored();

    const results = await Promise.all([1, 2, 3, 4].map((n) => addReference(assignment.id, owner.cookie, PDF, `${n}.pdf`)));

    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 201, 422]);
    expect((await rowsOf(assignment.id)).map((row) => row.ordinal)).toEqual([1, 2, 3]);
    expect(await objectsStored()).toBe(before + 3); // the one that lost the place removed its object again
  });

  it('on a published assignment, adding or removing needs the re-grade confirmation, which does not exist yet', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);
    await publish(assignment.id);
    const before = await objectsStored();

    const add = await addReference(assignment.id, owner.cookie, PDF, 'late.pdf').field('impactToken', 'whatever');
    expect([add.status, add.body.error.code]).toEqual([422, 'CONFIRMATION_REQUIRED']);
    const remove = await deleteReference(added.body.id, owner.cookie);
    expect([remove.status, remove.body.error.code]).toEqual([422, 'CONFIRMATION_REQUIRED']);

    const rows = await rowsOf(assignment.id);
    expect(rows).toHaveLength(1);
    expect(await objectsStored()).toBe(before);
    expect(await db.storageDeletion.count({ where: { bucket: BUCKET, objectPath: rows[0]!.storagePath } })).toBe(0);
  });

  it('shows or hides a file from students, also after publishing, and the body must be exactly that', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);
    await publish(assignment.id);

    const shown = await patchReference(added.body.id, owner.cookie, { visibleToStudents: true });
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ id: added.body.id, visibleToStudents: true });
    expect((await rowsOf(assignment.id))[0]!.visibleToStudents).toBe(true);
    expect((await patchReference(added.body.id, owner.cookie, { visibleToStudents: false })).body.visibleToStudents).toBe(false);

    for (const bad of [{}, { visibleToStudents: 'yes' }, { visibleToStudents: true, label: 'x' }]) {
      const res = await patchReference(added.body.id, owner.cookie, bad);
      expect([res.status, res.body.error.code], JSON.stringify(bad)).toEqual([400, 'VALIDATION']);
    }
  });

  it('shows an instructor every file and a student only the ones marked visible, on a published assignment', async () => {
    const assignment = await draft();
    const first = await addReference(assignment.id, owner.cookie, PDF, '1.pdf');
    await addReference(assignment.id, owner.cookie, PNG, '2.png', 'image/png');
    await patchReference(first.body.id, owner.cookie, { visibleToStudents: true });
    await publish(assignment.id);

    const instructorView = await readBy(assignment.id, owner.cookie);
    const studentView = await readBy(assignment.id, student.cookie);

    expect(instructorView.body.referenceFiles.map((file: { label: string }) => file.label)).toEqual([
      'Reference file 1',
      'Reference file 2',
    ]);
    expect(studentView.body.referenceFiles).toEqual([
      expect.objectContaining({ id: first.body.id, label: 'Reference file 1', visibleToStudents: true }),
    ]);
  });

  it('is the owning instructor’s alone to add, change and remove: others find nothing, and signed out is 401', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);
    const before = await objectsStored();

    for (const who of [other, student, admin]) {
      for (const res of [
        await addReference(assignment.id, who.cookie, PDF),
        await patchReference(added.body.id, who.cookie, { visibleToStudents: true }),
        await deleteReference(added.body.id, who.cookie),
      ]) {
        expect([res.status, res.body.error.code], who.user.email).toEqual([404, 'NOT_FOUND']);
      }
    }
    expect((await addReference(randomUUID(), owner.cookie, PDF)).body.error.code).toBe('NOT_FOUND');
    expect((await patchReference(randomUUID(), owner.cookie, { visibleToStudents: true })).body.error.code).toBe('NOT_FOUND');
    expect((await deleteReference(randomUUID(), owner.cookie)).body.error.code).toBe('NOT_FOUND');
    expect((await addReference(assignment.id, undefined, PDF)).status).toBe(401);
    expect((await patchReference(added.body.id, undefined, { visibleToStudents: true })).status).toBe(401);
    expect((await deleteReference(added.body.id)).status).toBe(401);

    expect(await rowsOf(assignment.id)).toHaveLength(1);
    expect(await objectsStored()).toBe(before);
  });

  it('is read-only in an archived class', async () => {
    const archived = await seedClass(owner.user.id);
    const assignment = await draft(archived.id);
    const added = await addReference(assignment.id, owner.cookie, PDF);
    await db.class.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    for (const res of [
      await addReference(assignment.id, owner.cookie, PDF),
      await patchReference(added.body.id, owner.cookie, { visibleToStudents: true }),
      await deleteReference(added.body.id, owner.cookie),
    ]) {
      expect([res.status, res.body.error.code]).toEqual([409, 'CLASS_ARCHIVED']);
    }
    expect(await rowsOf(assignment.id)).toHaveLength(1);
  });

  it('gives the owner a five-minute link, and a student one only for a visible file of a published assignment', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);

    const ownerLink = await linkTo(added.body.id, owner.cookie);
    expect(ownerLink.status).toBe(200);
    expect(ReferenceFileLinkSchema.parse(ownerLink.body).url.length).toBeGreaterThan(10);
    const lasts = new Date(ownerLink.body.expiresAt).getTime() - Date.now();
    expect(lasts).toBeGreaterThan(4 * 60 * 1000);
    expect(lasts).toBeLessThanOrEqual(5 * 60 * 1000);

    // Hidden, and the assignment is still a draft: nothing for the student.
    expect((await linkTo(added.body.id, student.cookie)).body.error.code).toBe('NOT_FOUND');
    await patchReference(added.body.id, owner.cookie, { visibleToStudents: true });
    expect((await linkTo(added.body.id, student.cookie)).status).toBe(404); // visible, but the assignment is not published
    await publish(assignment.id);
    expect((await linkTo(added.body.id, student.cookie)).status).toBe(200);
    await patchReference(added.body.id, owner.cookie, { visibleToStudents: false });
    expect((await linkTo(added.body.id, student.cookie)).body.error.code).toBe('NOT_FOUND'); // hidden again
  });

  it('gives no link to a pending, declined, removed or outside student, another instructor or the Super Admin, whatever the file shows', async () => {
    const assignment = await draft();
    const added = await addReference(assignment.id, owner.cookie, PDF);
    await patchReference(added.body.id, owner.cookie, { visibleToStudents: true });
    await publish(assignment.id);
    const pending = await enrolledStudent('ref-pending', cls.id, 'PENDING');
    const declined = await enrolledStudent('ref-declined', cls.id, 'DECLINED');
    const removed = await enrolledStudent('ref-removed', cls.id, 'REMOVED');
    const outsider = await signedInUser('ref-outsider', 'STUDENT');

    for (const who of [pending, declined, removed, outsider, other, admin]) {
      const res = await linkTo(added.body.id, who.cookie);
      expect([res.status, res.body.error.code], who.user.email).toEqual([404, 'NOT_FOUND']);
    }
    expect((await linkTo(added.body.id)).status).toBe(401);
    expect((await linkTo(randomUUID(), owner.cookie)).status).toBe(404);
  });
});
