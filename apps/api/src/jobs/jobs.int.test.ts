import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { PgBoss } from 'pg-boss';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGemini } from '@edugemini/ai';
import { TERMS_VERSION } from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLocalStorage } from '../lib/local-storage';
import { createLogger } from '../lib/logger';
import type { StorageAdapter } from '../lib/storage';
import { uploadsRouter } from '../routes/uploads';
import { newJoinCode } from '../services/class-service';
import { saveKey } from '../services/key-service';
import { createTestDb, testDatabaseUrl } from '../test/test-db';
import { createGradingSender, sendGradeJob } from './grade-submission.job';
import { startJobs } from './index';
import { runStorageCleanup, STORAGE_CLEANUP } from './storage-cleanup.job';
import { STAGED_CLEANUP } from './staged-cleanup.job';

// Runs against the test database, with the files in a temporary folder. Every row carries this run's ID, so tests never
// collide and cleanup is exact.
const RUN = randomUUID().slice(0, 8);
const BUCKET = `test-${RUN}`;
const logger = createLogger('silent', 'test');

const db = createTestDb();
let storageDir: string;
let storage: StorageAdapter;

const putObject = (path: string) => storage.put(BUCKET, path, Readable.from([Buffer.from('object')]), 'application/pdf', 1024);
const queueDeletion = (path: string, data: { attempts?: number; completedAt?: Date } = {}) =>
  db.storageDeletion.create({ data: { bucket: BUCKET, objectPath: path, ...data } });
const row = (path: string) => db.storageDeletion.findUniqueOrThrow({ where: { bucket_objectPath: { bucket: BUCKET, objectPath: path } } });

beforeAll(async () => {
  await db.$connect();
  storageDir = await mkdtemp(join(tmpdir(), 'edugemini-jobs-test-'));
  storage = createLocalStorage({ dir: storageDir, appUrl: 'http://localhost:5173', secret: 'a-test-secret-of-at-least-32-characters' });
});

afterAll(async () => {
  await db.storageDeletion.deleteMany({ where: { bucket: BUCKET } });
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: `-${RUN}@example.test` } } } }); // assignments, submissions go with it
  await db.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.test` } } });
  await db.$disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe('storage.cleanup (the storage outbox)', () => {
  it('deletes the object and marks its row complete', async () => {
    const path = `${RUN}/one.pdf`;
    await putObject(path);
    await queueDeletion(path);

    await runStorageCleanup({ db, storage, logger });

    expect(await storage.exists(BUCKET, path)).toBe(false);
    expect(await row(path)).toMatchObject({ attempts: 1, lastError: null });
    expect((await row(path)).completedAt).not.toBeNull();
  });

  it('counts an object that is already gone as deleted', async () => {
    const path = `${RUN}/never-stored.pdf`;
    await queueDeletion(path);

    await runStorageCleanup({ db, storage, logger });

    expect((await row(path)).completedAt).not.toBeNull();
  });

  it('writes a failure on its row, leaves it pending and goes on with the others', async () => {
    const bad = `${RUN}/bad.pdf`;
    const good = `${RUN}/good.pdf`;
    await putObject(bad);
    await putObject(good);
    await queueDeletion(bad);
    await queueDeletion(good);
    const storageDown: StorageAdapter = {
      ...storage,
      remove: async (bucket, paths) => {
        if (paths[0] === bad) throw new Error('storage is down');
        return storage.remove(bucket, paths);
      },
    };

    await runStorageCleanup({ db, storage: storageDown, logger });

    expect(await row(bad)).toMatchObject({ completedAt: null, attempts: 1, lastError: 'storage is down' });
    expect((await row(good)).completedAt).not.toBeNull();
    expect(await storage.exists(BUCKET, bad)).toBe(true);

    await runStorageCleanup({ db, storage, logger }); // storage is back
    expect(await row(bad)).toMatchObject({ attempts: 2, lastError: null });
    expect((await row(bad)).completedAt).not.toBeNull();
    expect(await storage.exists(BUCKET, bad)).toBe(false);
  });

  it('does not count an object as deleted while it is still there', async () => {
    const path = `${RUN}/stubborn.pdf`;
    await putObject(path);
    await queueDeletion(path);
    const ignoresRemove: StorageAdapter = { ...storage, remove: async () => {} };

    await runStorageCleanup({ db, storage: ignoresRemove, logger });

    expect(await row(path)).toMatchObject({ completedAt: null, attempts: 1 });
    expect((await row(path)).lastError).toContain('still there');
  });

  it('tries the rows that have failed before after the fresh ones, and leaves completed rows alone', async () => {
    const failedBefore = `${RUN}/failed-before.pdf`;
    const fresh = `${RUN}/fresh.pdf`;
    const finished = `${RUN}/finished.pdf`;
    await queueDeletion(failedBefore, { attempts: 3 }); // older than `fresh`, but it has failed more often
    await queueDeletion(fresh);
    await queueDeletion(finished, { completedAt: new Date() });
    const tried: string[] = [];
    const recording: StorageAdapter = {
      ...storage,
      remove: async (bucket, paths) => {
        tried.push(...paths);
        return storage.remove(bucket, paths);
      },
    };

    await runStorageCleanup({ db, storage: recording, logger });

    expect(tried.filter((path) => path.startsWith(`${RUN}/f`))).toEqual([fresh, failedBefore]);
    expect((await row(finished)).attempts).toBe(0);
  });
});

describe('the worker (startJobs)', () => {
  let boss: PgBoss;
  const pending = `${RUN}/pending-at-start.pdf`;
  let staleVersionId: string;
  let instructorId: string;
  let studentId: string;
  let classId: string;
  // The pacer is ours, so a test can make the instructor wait for a token.
  const pacer = { take: vi.fn((_instructorId: string) => 0) };
  const ENV = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENCRYPTION_KEY_VERSION: 1 };

  beforeAll(async () => {
    // Work waiting before the worker starts: an object in the outbox, and an upload opened 25 hours ago.
    await putObject(pending);
    await queueDeletion(pending);
    const instructor = await db.user.create({ data: userData('instructor', 'INSTRUCTOR') });
    const student = await db.user.create({ data: userData('student', 'STUDENT') });
    const cls = await db.class.create({ data: { instructorId: instructor.id, name: 'Jobs test', joinCode: newJoinCode(), attestedAt: new Date() } });
    const assignment = await db.assignment.create({
      data: { classId: cls.id, title: 'Jobs test', criteriaText: 'Clear thesis.', dueAt: new Date(Date.now() + 86_400_000), timezone: 'UTC', scoringFormat: 'POINTS', maxScore: 100, maxResubmissions: 3, status: 'PUBLISHED', publishedAt: new Date() },
    });
    const submission = await db.submission.create({ data: { assignmentId: assignment.id, studentId: student.id } });
    const stale = await db.submissionVersion.create({ data: { submissionId: submission.id, versionNo: 1, createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    staleVersionId = stale.id;
    instructorId = instructor.id;
    studentId = student.id;
    classId = cls.id;
    await saveKey(db, ENV, { id: instructor.id, role: 'INSTRUCTOR' }, `AIza${randomBytes(18).toString('hex')}`, new Date());

    // This connects as the test project's owner. In production the worker connects as `app_runtime`, which cannot log in on
    // the test project, so the grants in Backend Schema §11.1 are not exercised here (progress tracker, Up next).
    boss = await startJobs(testDatabaseUrl(), { db, storage, bucket: BUCKET, gemini: createFakeGemini(), pacer, env: ENV, logger });
  });

  afterAll(async () => {
    await boss.stop();
  });

  function userData(name: string, role: 'INSTRUCTOR' | 'STUDENT') {
    return { email: `${name}-${RUN}@example.test`, firstName: 'Ada', lastName: 'Lovelace', role, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION };
  }

  it('creates every queue of TRD §10.1, with grading limited to one running job per key', async () => {
    const queues = (await boss.getQueues()).map((queue) => queue.name);
    expect(queues).toEqual(
      expect.arrayContaining(['grade.submission', 'regrade.assignment', 'send.email', 'digest.flush', 'retention.sweep', STAGED_CLEANUP, STORAGE_CLEANUP]),
    );
    expect(await boss.getQueue('grade.submission')).toMatchObject({ policy: 'singleton', retryLimit: 2, retryDelay: 5, retryBackoff: true, retryDelayMax: 60 });
    expect(await boss.getQueue('send.email')).toMatchObject({ retryLimit: 5 });
  });

  it('puts both jobs on their schedules', async () => {
    const schedules = await boss.getSchedules();
    expect(schedules.find((s) => s.name === STAGED_CLEANUP)?.cron).toBe('0 * * * *');
    expect(schedules.find((s) => s.name === STORAGE_CLEANUP)?.cron).toBe('*/5 * * * *');
  });

  it('runs each job once at start', async () => {
    await vi.waitFor(async () => expect((await row(pending)).completedAt).not.toBeNull(), { timeout: 20_000, interval: 250 });
    expect(await storage.exists(BUCKET, pending)).toBe(false);
    await vi.waitFor(async () => expect(await db.submissionVersion.count({ where: { id: staleVersionId } })).toBe(0), { timeout: 20_000, interval: 250 });
  });

  it('runs a job that is sent to a queue', async () => {
    const path = `${RUN}/sent-later.pdf`;
    await putObject(path);
    await queueDeletion(path);

    await boss.send(STORAGE_CLEANUP);

    await vi.waitFor(async () => expect((await row(path)).completedAt).not.toBeNull(), { timeout: 20_000, interval: 250 });
    expect(await storage.exists(BUCKET, path)).toBe(false);
  });

  /** A queued submission with a stored version and no files, for an assignment of its own. */
  async function queuedSubmission() {
    const assignment = await db.assignment.create({
      data: { classId, title: 'Grading job test', criteriaText: 'Clear thesis.', dueAt: new Date(Date.now() + 86_400_000), timezone: 'UTC', scoringFormat: 'POINTS', maxScore: 100, status: 'PUBLISHED', publishedAt: new Date() },
    });
    const submission = await db.submission.create({ data: { assignmentId: assignment.id, studentId } });
    const version = await db.submissionVersion.create({ data: { submissionId: submission.id, versionNo: 1, status: 'STORED', storedAt: new Date() } });
    await db.submission.update({ where: { id: submission.id }, data: { state: 'QUEUED', currentVersionId: version.id } });
    return { submissionId: submission.id, versionId: version.id, mode: 'first' as const };
  }
  const stateOf = async (submissionId: string) => (await db.submission.findUniqueOrThrow({ where: { id: submissionId } })).state;

  it('runs a grading job that is sent to its queue', async () => {
    const job = await queuedSubmission();

    await sendGradeJob(boss, job);

    await vi.waitFor(async () => expect(await stateOf(job.submissionId)).toBe('AI_GENERATED'), { timeout: 20_000, interval: 250 });
    expect(await db.gradeResult.count({ where: { submissionId: job.submissionId, status: 'ACTIVE' } })).toBe(1);
  });

  it('sends the job again to start later when the instructor has no token, and then grades it', async () => {
    const job = await queuedSubmission();
    pacer.take.mockClear();
    pacer.take.mockReturnValueOnce(1); // wait one second, then go

    await sendGradeJob(boss, job);

    await vi.waitFor(async () => expect(await stateOf(job.submissionId)).toBe('AI_GENERATED'), { timeout: 30_000, interval: 250 });
    expect(pacer.take).toHaveBeenCalledTimes(2);
    expect(pacer.take).toHaveBeenCalledWith(instructorId);
  });

  describe('a student submits over HTTP and the worker grades it (finalize to a stored result)', () => {
    const APP_URL = 'http://localhost:5173';
    let app: ReturnType<typeof createApp>;
    let cookie: string;

    beforeAll(async () => {
      await db.enrollment.create({ data: { classId, studentId, status: 'ACTIVE' } });
      cookie = `${SESSION_COOKIE}=${await createSession(db, studentId)}`;
      // The app's finalize sends its grading job to the same worker, as `main.ts` wires it.
      app = createApp({
        env: { APP_URL },
        logger,
        db,
        checkDb: async () => {},
        routers: [uploadsRouter({ db, storage, bucket: BUCKET, enqueueGrading: createGradingSender(Promise.resolve(boss), logger) })],
      });
    });

    /** Opens an upload, sends one image (the fake Gemini reads its scenario from the name) and finalizes. Returns the submission's ID. */
    async function submit(scenario?: string) {
      const assignment = await db.assignment.create({
        data: { classId, title: 'HTTP grading test', criteriaText: 'Clear thesis.', dueAt: new Date(Date.now() + 86_400_000), timezone: 'UTC', scoringFormat: 'POINTS', maxScore: 100, maxResubmissions: 3, status: 'PUBLISHED', publishedAt: new Date() },
      });
      const opened = await request(app).post(`/api/assignments/${assignment.id}/versions`).set('Origin', APP_URL).set('Cookie', cookie);
      expect(opened.status).toBe(201);
      const clientFileId = `http-${randomUUID()}`;
      const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]); // new bytes each time: the fake counts calls by file content
      const sent = await request(app)
        .put(`/api/versions/${opened.body.id}/files/${clientFileId}`)
        .set('Origin', APP_URL)
        .set('Cookie', cookie)
        .set('Content-Type', 'image/png')
        .set('X-File-Name', encodeURIComponent(scenario ? `essay__scenario-${scenario}__.png` : 'essay.png'))
        .send(image);
      expect(sent.status).toBe(201);
      const finalized = await request(app).post(`/api/versions/${opened.body.id}/finalize`).set('Origin', APP_URL).set('Cookie', cookie).send({ expectedFileIds: [clientFileId] });
      expect(finalized.status).toBe(200);
      return (await db.submission.findUniqueOrThrow({ where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } } })).id;
    }
    const submissionOf = (id: string) => db.submission.findUniqueOrThrow({ where: { id } });
    const attemptsOf = (submissionId: string) => db.gradingAttempt.findMany({ where: { submissionId }, orderBy: { attemptNo: 'asc' } });

    it('stores an AI result, notifies the student and records one attempt', async () => {
      const id = await submit();

      await vi.waitFor(async () => expect((await submissionOf(id)).state).toBe('AI_GENERATED'), { timeout: 20_000, interval: 250 });

      const submission = await submissionOf(id);
      const grade = await db.gradeResult.findUniqueOrThrow({ where: { id: submission.activeGradeId! } });
      expect(grade).toMatchObject({ source: 'AI', status: 'ACTIVE', model: 'fake' });
      expect(Number(grade.score)).toBe(85);
      expect(await attemptsOf(id)).toMatchObject([{ attemptNo: 1, outcome: 'SUCCESS' }]);
      expect(await db.notification.count({ where: { userId: studentId, type: 'SUBMISSION_GRADED' } })).toBeGreaterThan(0);
    });

    it.each([
      ['key-invalid', 'KEY_INVALID'],
      ['file-quality', 'FILE_QUALITY'],
    ] as const)('sends a %s failure to manual review (%s) on the first try, with no retry', async (scenario, cause) => {
      const id = await submit(scenario);

      await vi.waitFor(async () => expect((await submissionOf(id)).state).toBe('NEEDS_MANUAL_REVIEW'), { timeout: 20_000, interval: 250 });

      expect((await submissionOf(id)).manualReviewCause).toBe(cause);
      expect(await attemptsOf(id)).toHaveLength(1);
    });

    it('retries a timeout in silence and grades on the second try (timeout-then-ok)', async () => {
      const id = await submit('timeout-then-ok');

      await vi.waitFor(async () => expect((await submissionOf(id)).state).toBe('AI_GENERATED'), { timeout: 60_000, interval: 500 });

      expect((await attemptsOf(id)).map((a) => [a.attemptNo, a.outcome])).toEqual([
        [1, 'TRANSIENT_ERROR'],
        [2, 'SUCCESS'],
      ]);
    }, 90_000); // pg-boss waits 5 s or more before the retry

    it('tries three times in all and then sends a timeout that never ends to manual review as AI_FAILED (timeout-always)', async () => {
      const id = await submit('timeout-always');

      await vi.waitFor(async () => expect((await submissionOf(id)).state).toBe('NEEDS_MANUAL_REVIEW'), { timeout: 90_000, interval: 500 });

      expect((await submissionOf(id)).manualReviewCause).toBe('AI_FAILED');
      expect((await attemptsOf(id)).map((a) => [a.attemptNo, a.outcome])).toEqual([
        [1, 'TRANSIENT_ERROR'],
        [2, 'TRANSIENT_ERROR'],
        [3, 'TRANSIENT_ERROR'],
      ]);
    }, 120_000); // the two waits between the three tries are 5 to 10 s and 10 to 20 s
  });
});
