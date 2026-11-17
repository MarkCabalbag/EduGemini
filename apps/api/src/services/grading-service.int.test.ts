import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Job, PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGemini, GeminiError, PROMPT_VERSION, type GeminiAdapter } from '@edugemini/ai';
import { TERMS_VERSION, type GradeJob } from '@edugemini/shared';
import { GRADE_SUBMISSION, gradeSubmissionHandler } from '../jobs/grade-submission.job';
import { createLocalStorage } from '../lib/local-storage';
import { createLogger } from '../lib/logger';
import type { Pacer } from '../lib/pacing';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';
import { gradeSubmission, moveToManualReview, type GradingDeps } from './grading-service';
import { saveKey } from './key-service';

// Runs against the test database, with the files in a temporary folder and the fake Gemini. Every email carries this run's ID,
// so tests never collide and cleanup is exact.
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const BUCKET = `test-${RUN}`;
const ENV = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENCRYPTION_KEY_VERSION: 1 };
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const db = createTestDb();
let storageDir: string;
let storage: ReturnType<typeof createLocalStorage>;
let student: { id: string };

type KeyState = 'ok' | 'none' | 'NEEDS_ATTENTION' | 'QUOTA_REACHED';

/** An instructor (with a key in the given state), a class, a published assignment, and the student's stored first version. */
let seeded = 0;
async function seedWorld({ key = 'ok', fileNames = ['essay.png'] }: { key?: KeyState; fileNames?: string[] } = {}) {
  const n = ++seeded;
  const instructor = await db.user.create({
    data: { email: `instructor${n}${EMAIL_END}`, firstName: 'Grace', lastName: 'Hopper', role: 'INSTRUCTOR', termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
  });
  const apiKey = `AIza${randomBytes(18).toString('hex')}`;
  if (key !== 'none') {
    await saveKey(db, ENV, { id: instructor.id, role: 'INSTRUCTOR' }, apiKey, new Date());
    if (key !== 'ok') await db.instructorKey.update({ where: { instructorId: instructor.id }, data: { status: key } });
  }
  const cls = await db.class.create({ data: { instructorId: instructor.id, name: `Grading class ${n}`, joinCode: newJoinCode(), attestedAt: new Date() } });
  const assignment = await db.assignment.create({
    data: {
      classId: cls.id,
      title: `Essay ${n}`,
      instructions: 'Write about a river.',
      criteriaText: 'Clear thesis (10 points).',
      dueAt: new Date(Date.now() + 86_400_000),
      timezone: 'UTC',
      scoringFormat: 'POINTS',
      maxScore: 100,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  const submission = await db.submission.create({ data: { assignmentId: assignment.id, studentId: student.id } });
  const version = await seedVersion(submission.id, 1, fileNames);
  await db.submission.update({ where: { id: submission.id }, data: { state: 'QUEUED', currentVersionId: version.id } });
  const job: GradeJob = { submissionId: submission.id, versionId: version.id, mode: 'first' };
  return { instructor, apiKey, cls, assignment, submission, version, job, fileNames };
}

/** A stored version whose files hold different bytes each time, so the fake's call counts never mix between tests. */
async function seedVersion(submissionId: string, versionNo: number, fileNames: string[]) {
  const version = await db.submissionVersion.create({ data: { submissionId, versionNo, status: 'STORED', storedAt: new Date() } });
  for (const [index, name] of fileNames.entries()) {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.from(`${name} ${randomUUID()}`)]);
    const path = `${RUN}/${version.id}/${index}.png`;
    await storage.put(BUCKET, path, Readable.from([bytes]), 'image/png', 1024 * 1024);
    await db.submissionFile.create({
      data: {
        versionId: version.id,
        clientFileId: `file-${index}`,
        ordinal: index + 1,
        storagePath: path,
        displayName: name,
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), // a stored file must have it (submission_files_stored_fields)
      },
    });
  }
  return version;
}

/** The deps with a Gemini whose calls are counted, a pacer that always says go, and any part replaced. */
function makeDeps(overrides: { grade?: GeminiAdapter['grade']; pacer?: Pacer } = {}) {
  const fake = createFakeGemini();
  const grade = vi.fn<GeminiAdapter['grade']>(overrides.grade ?? fake.grade);
  const pacer: Pacer = overrides.pacer ?? { take: vi.fn(() => 0) };
  const deps: GradingDeps = { db, storage, bucket: BUCKET, gemini: { model: 'fake', grade }, pacer, env: ENV, logger: createLogger('silent', 'test') };
  return { deps, grade, pacer };
}

const attemptsOf = (submissionId: string) => db.gradingAttempt.findMany({ where: { submissionId }, orderBy: { attemptNo: 'asc' } });
const submissionOf = (submissionId: string) => db.submission.findUniqueOrThrow({ where: { id: submissionId } });
const gradesOf = (submissionId: string) => db.gradeResult.findMany({ where: { submissionId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await db.$connect();
  storageDir = await mkdtemp(join(tmpdir(), 'edugemini-grading-test-'));
  storage = createLocalStorage({ dir: storageDir, appUrl: 'http://localhost:5173', secret: 'a-test-secret-of-at-least-32-characters' });
  student = await db.user.create({
    data: { email: `student${EMAIL_END}`, firstName: 'Ada', lastName: 'Lovelace', role: 'STUDENT', termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
  });
});

afterAll(async () => {
  await db.class.deleteMany({ where: { instructor: { email: { endsWith: EMAIL_END } } } }); // assignments, submissions, grades go with it
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe('gradeSubmission: a result is stored (EG-AI-03, TRD §10.3)', () => {
  it('stores an active AI result, moves the submission to AI_GENERATED, notifies the student and records the attempt', async () => {
    const world = await seedWorld();
    const { deps } = makeDeps();

    expect(await gradeSubmission(deps, world.job, { attemptNo: 1 })).toBeUndefined();

    const submission = await submissionOf(world.submission.id);
    const [grade] = await gradesOf(world.submission.id);
    expect(submission).toMatchObject({ state: 'AI_GENERATED', manualReviewCause: null, activeGradeId: grade?.id });
    expect(grade).toMatchObject({
      source: 'AI',
      status: 'ACTIVE',
      versionId: world.version.id,
      feedback: 'Fake feedback: the work was read and graded.',
      criteriaVersion: 1,
      model: 'fake',
      promptVersion: PROMPT_VERSION,
      confidence: 'high',
      readabilityIssue: false,
      letter: null,
    });
    expect(Number(grade?.score)).toBe(85);

    expect(await attemptsOf(world.submission.id)).toMatchObject([{ attemptNo: 1, outcome: 'SUCCESS', model: 'fake', errorClass: null, versionId: world.version.id }]);
    const [notification] = await db.notification.findMany({ where: { userId: student.id, link: `/assignments/${world.assignment.id}` } });
    expect(notification).toMatchObject({ type: 'SUBMISSION_GRADED', payload: { className: world.cls.name } });
  });

  it('marks the previous active result superseded, so exactly one is active', async () => {
    const world = await seedWorld();
    const old = await db.gradeResult.create({
      data: {
        submissionId: world.submission.id,
        versionId: world.version.id,
        source: 'AI',
        status: 'ACTIVE',
        score: 10,
        feedback: 'Older.',
        criteriaVersion: 1,
        model: 'fake', // an AI result must say which model and prompt made it (grade_results_ai_provenance)
        promptVersion: PROMPT_VERSION,
        confidence: 'low',
      },
    });
    const { deps } = makeDeps();

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    const grades = await gradesOf(world.submission.id);
    expect(grades.map((grade) => grade.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    expect(grades[0]?.id).toBe(old.id);
    expect((await submissionOf(world.submission.id)).activeGradeId).toBe(grades[1]?.id);
  });

  it('accepts a score equal to the maximum', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-score-100__.png'] });
    const { deps } = makeDeps();

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    expect(Number((await gradesOf(world.submission.id))[0]?.score)).toBe(100);
  });

  it('gives Gemini the key, the assignment and the files in order, and nothing that names the student', async () => {
    const world = await seedWorld({ fileNames: ['first.png', 'second.png'] });
    const { deps, grade } = makeDeps();

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    expect(grade).toHaveBeenCalledTimes(1);
    const [input, apiKey] = grade.mock.calls[0]!;
    expect(apiKey).toBe(world.apiKey);
    expect(input.assignment).toEqual({
      title: world.assignment.title,
      instructions: 'Write about a river.',
      criteriaText: 'Clear thesis (10 points).',
      scoringFormat: 'POINTS',
      maxScore: 100,
    });
    expect(input.studentFiles.map((file) => [file.displayName, file.mimeType])).toEqual([
      ['first.png', 'image/png'],
      ['second.png', 'image/png'],
    ]);
    expect(input.studentFiles[0]?.data.subarray(0, 8)).toEqual(PNG_HEAD);
    const sent = JSON.stringify(input);
    for (const identity of [student.id, `student${EMAIL_END}`, 'Ada', 'Lovelace']) expect(sent).not.toContain(identity);
  });

  it('records each try, so a failed first try and a good second one leave two attempts', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-timeout-then-ok__.png'] });
    const { deps } = makeDeps();

    await expect(gradeSubmission(deps, world.job, { attemptNo: 1 })).rejects.toMatchObject({ kind: 'TRANSIENT' });
    expect((await submissionOf(world.submission.id)).state).toBe('GRADING');
    await gradeSubmission(deps, world.job, { attemptNo: 2 });

    expect((await attemptsOf(world.submission.id)).map((a) => [a.attemptNo, a.outcome, a.errorClass])).toEqual([
      [1, 'TRANSIENT_ERROR', 'TRANSIENT'],
      [2, 'SUCCESS', null],
    ]);
    expect((await submissionOf(world.submission.id)).state).toBe('AI_GENERATED');
  });
});

describe('gradeSubmission: a stale job (TRD §10.3 steps 1 and 6)', () => {
  it('discards a job for a version that is not the current one, without calling Gemini', async () => {
    const world = await seedWorld();
    const newer = await seedVersion(world.submission.id, 2, ['newer.png']);
    await db.submission.update({ where: { id: world.submission.id }, data: { currentVersionId: newer.id } });
    const { deps, grade } = makeDeps();

    expect(await gradeSubmission(deps, world.job, { attemptNo: 1 })).toBeUndefined();

    expect(grade).not.toHaveBeenCalled();
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect(await attemptsOf(world.submission.id)).toMatchObject([{ outcome: 'STALE_DISCARDED', model: null }]);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'QUEUED', currentVersionId: newer.id });
  });

  it('discards the answer when a newer version arrived during the call, and changes nothing else', async () => {
    const world = await seedWorld();
    const real = createFakeGemini();
    const { deps } = makeDeps({
      grade: async (input, apiKey, options) => {
        const newer = await seedVersion(world.submission.id, 2, ['newer.png']);
        await db.submission.update({ where: { id: world.submission.id }, data: { currentVersionId: newer.id, state: 'QUEUED' } });
        return real.grade(input, apiKey, options);
      },
    });

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'QUEUED', activeGradeId: null });
    expect(await attemptsOf(world.submission.id)).toMatchObject([{ outcome: 'STALE_DISCARDED', model: 'fake' }]);
    expect(await db.notification.count({ where: { userId: student.id, link: `/assignments/${world.assignment.id}` } })).toBe(0);
  });

  it('does nothing for a submission that no longer exists', async () => {
    const { deps, grade } = makeDeps();
    const job: GradeJob = { submissionId: randomUUID(), versionId: randomUUID(), mode: 'first' };

    expect(await gradeSubmission(deps, job, { attemptNo: 1 })).toBeUndefined();
    expect(grade).not.toHaveBeenCalled();
  });
});

describe('gradeSubmission: the key (TRD §10.3 step 2)', () => {
  it.each([
    ['none', 'KEY_MISSING'],
    ['NEEDS_ATTENTION', 'KEY_INVALID'],
    ['QUOTA_REACHED', 'KEY_QUOTA'],
  ] as const)('with a key that is %s, sends the submission to manual review (%s) without calling Gemini or using a token', async (key, cause) => {
    const world = await seedWorld({ key });
    const { deps, grade, pacer } = makeDeps();

    expect(await gradeSubmission(deps, world.job, { attemptNo: 1 })).toBeUndefined();

    expect(grade).not.toHaveBeenCalled();
    expect(pacer.take).not.toHaveBeenCalled();
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: cause });
    expect(await attemptsOf(world.submission.id)).toHaveLength(0);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
  });
});

describe('gradeSubmission: pacing (TRD §10.2)', () => {
  it('asks to be sent again when the instructor has no token, and leaves the submission queued', async () => {
    const world = await seedWorld();
    const { deps, grade, pacer } = makeDeps({ pacer: { take: vi.fn(() => 7) } });

    expect(await gradeSubmission(deps, world.job, { attemptNo: 1 })).toEqual({ waitSeconds: 7 });

    expect(pacer.take).toHaveBeenCalledWith(world.instructor.id);
    expect(grade).not.toHaveBeenCalled();
    expect((await submissionOf(world.submission.id)).state).toBe('QUEUED');
    expect(await attemptsOf(world.submission.id)).toHaveLength(0);
  });
});

describe('gradeSubmission: a call that fails (TRD §10.7)', () => {
  it('records a transient failure and throws, so the job is tried again, and leaves the submission grading', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-timeout-always__.png'] });
    const { deps } = makeDeps();

    await expect(gradeSubmission(deps, world.job, { attemptNo: 2 })).rejects.toBeInstanceOf(GeminiError);

    expect(await attemptsOf(world.submission.id)).toMatchObject([{ attemptNo: 2, outcome: 'TRANSIENT_ERROR', errorClass: 'TRANSIENT', model: 'fake' }]);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'GRADING', manualReviewCause: null });
  });

  it.each([
    ['key-invalid', 'KEY_ERROR', 'KEY_INVALID', 'KEY_INVALID'],
    ['quota-daily', 'QUOTA_ERROR', 'QUOTA', 'KEY_QUOTA'],
    ['file-quality', 'FILE_ERROR', 'FILE_QUALITY', 'FILE_QUALITY'],
  ] as const)('sends the %s scenario to manual review (%s) without throwing, so it is not retried', async (scenario, outcome, errorClass, cause) => {
    const world = await seedWorld({ fileNames: [`__scenario-${scenario}__.png`] });
    const { deps, grade } = makeDeps();

    expect(await gradeSubmission(deps, world.job, { attemptNo: 1 })).toBeUndefined();

    expect(grade).toHaveBeenCalledTimes(1);
    expect(await attemptsOf(world.submission.id)).toMatchObject([{ attemptNo: 1, outcome, errorClass, model: 'fake' }]);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: cause });
  });

  it('does not touch the instructor\'s key status: that is written by the key tickets (KEY-05, KEY-07)', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-key-invalid__.png'] });
    const { deps } = makeDeps();

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    expect((await db.instructorKey.findUniqueOrThrow({ where: { instructorId: world.instructor.id } })).status).toBe('CONNECTED');
  });

  it.each(['malformed-json', 'score-above-max'])('treats the %s answer as a transient error and stores no result', async (scenario) => {
    const world = await seedWorld({ fileNames: [`__scenario-${scenario}__.png`] });
    const { deps } = makeDeps();

    await expect(gradeSubmission(deps, world.job, { attemptNo: 1 })).rejects.toThrow(/not a valid grade/);

    expect(await attemptsOf(world.submission.id)).toMatchObject([{ outcome: 'TRANSIENT_ERROR', errorClass: 'INVALID_OUTPUT' }]);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
  });

  it('stops waiting for Gemini at the timeout and records it', async () => {
    const world = await seedWorld();
    const { deps } = makeDeps({
      grade: (_input, _key, { signal } = {}) => new Promise<string>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))),
    });

    await expect(gradeSubmission(deps, world.job, { attemptNo: 1, timeoutMs: 50 })).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(await attemptsOf(world.submission.id)).toMatchObject([{ outcome: 'TRANSIENT_ERROR', errorClass: 'TIMEOUT' }]);
  });

  it('stops the call when the job is stopped at shutdown', async () => {
    const world = await seedWorld();
    const shutdown = new AbortController();
    const { deps } = makeDeps({
      grade: (_input, _key, { signal } = {}) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
          shutdown.abort(); // the worker is stopping while Gemini is still working
        }),
    });

    await expect(gradeSubmission(deps, world.job, { attemptNo: 1, signal: shutdown.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses the mode that is not built yet, before it reads anything', async () => {
    const { deps, grade } = makeDeps();
    const job: GradeJob = { submissionId: randomUUID(), versionId: randomUUID(), mode: 'regrade_approved' };

    await expect(gradeSubmission(deps, job, { attemptNo: 1 })).rejects.toThrow(/REV-09/);
    expect(grade).not.toHaveBeenCalled();
  });
});

describe('gradeSubmission: a submission that is not waiting for grading (a duplicate job)', () => {
  it.each([
    ['AI_GENERATED', {}],
    ['INSTRUCTOR_APPROVED', { approvedAt: new Date() }],
    ['NEEDS_MANUAL_REVIEW', { manualReviewCause: 'AI_FAILED' }],
  ] as const)('does nothing when the submission is already %s', async (state, extra) => {
    const world = await seedWorld();
    await gradeSubmission(makeDeps().deps, world.job, { attemptNo: 1 }); // gives it an active result, which the approved state needs
    await db.submission.update({ where: { id: world.submission.id }, data: { state, ...extra } });
    const attemptsBefore = (await attemptsOf(world.submission.id)).length;
    const again = makeDeps();

    expect(await gradeSubmission(again.deps, world.job, { attemptNo: 1 })).toBeUndefined();

    expect(again.grade).not.toHaveBeenCalled();
    expect(await submissionOf(world.submission.id)).toMatchObject({ state, ...extra });
    expect(await attemptsOf(world.submission.id)).toHaveLength(attemptsBefore);
    expect(await gradesOf(world.submission.id)).toHaveLength(1);
  });

  it('leaves a graded submission and its result alone when the same job runs a second time', async () => {
    const world = await seedWorld();
    const { deps } = makeDeps();
    await gradeSubmission(deps, world.job, { attemptNo: 1 });
    const graded = await submissionOf(world.submission.id);

    const second = makeDeps({ grade: async () => { throw new GeminiError('TRANSIENT'); } });
    expect(await gradeSubmission(second.deps, world.job, { attemptNo: 1 })).toBeUndefined();

    expect(second.grade).not.toHaveBeenCalled();
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'AI_GENERATED', activeGradeId: graded.activeGradeId });
    expect(await gradesOf(world.submission.id)).toHaveLength(1);
  });

  it('does not store a result when the submission was decided while Gemini was working', async () => {
    const world = await seedWorld();
    const real = createFakeGemini();
    const { deps } = makeDeps({
      grade: async (input, apiKey, options) => {
        await db.submission.update({ where: { id: world.submission.id }, data: { state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'KEY_MISSING' } });
        return real.grade(input, apiKey, options);
      },
    });

    await gradeSubmission(deps, world.job, { attemptNo: 1 });

    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'KEY_MISSING' });
    expect(await attemptsOf(world.submission.id)).toMatchObject([{ outcome: 'STALE_DISCARDED' }]);
  });

  it('moveToManualReview does not demote a graded submission or move one that has a newer version', async () => {
    const graded = await seedWorld();
    await gradeSubmission(makeDeps().deps, graded.job, { attemptNo: 1 });
    await moveToManualReview(db, graded.job, 'AI_FAILED');
    expect(await submissionOf(graded.submission.id)).toMatchObject({ state: 'AI_GENERATED', manualReviewCause: null });

    const newer = await seedWorld();
    const next = await seedVersion(newer.submission.id, 2, ['next.png']);
    await db.submission.update({ where: { id: newer.submission.id }, data: { currentVersionId: next.id } });
    await moveToManualReview(db, newer.job, 'AI_FAILED');
    expect(await submissionOf(newer.submission.id)).toMatchObject({ state: 'QUEUED', manualReviewCause: null });
  });
});

describe('the grading handler: tries and the last try (TRD §10.7, EG-AI-06)', () => {
  /** What pg-boss gives the handler for one job: the payload, and how many times it has been retried. */
  const jobOf = (payload: GradeJob, retryCount: number) => ({ id: randomUUID(), name: GRADE_SUBMISSION, data: payload, retryCount, signal: new AbortController().signal }) as unknown as Job<GradeJob>;
  const run = (deps: GradingDeps, payload: GradeJob, retryCount: number, send = vi.fn()) =>
    gradeSubmissionHandler({ send } as unknown as PgBoss, deps)([jobOf(payload, retryCount)]);

  it('throws a transient failure on the first and second try, so pg-boss retries the job', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-timeout-always__.png'] });
    const { deps } = makeDeps();

    await expect(run(deps, world.job, 0)).rejects.toMatchObject({ kind: 'TRANSIENT' });
    await expect(run(deps, world.job, 1)).rejects.toMatchObject({ kind: 'TRANSIENT' });

    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'GRADING', manualReviewCause: null });
    expect((await attemptsOf(world.submission.id)).map((a) => a.attemptNo)).toEqual([1, 2]);
  });

  it('sends the submission to manual review with AI_FAILED on the third try, and the job finishes normally', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-timeout-always__.png'] });
    const { deps } = makeDeps();

    await expect(run(deps, world.job, 2)).resolves.toBeUndefined();

    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'AI_FAILED' });
    expect(await attemptsOf(world.submission.id)).toMatchObject([{ attemptNo: 3, outcome: 'TRANSIENT_ERROR' }]);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
  });

  it('counts the tries a re-sent job carries, so a wait for a pacing token does not give it three more', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-timeout-always__.png'] });
    const { deps } = makeDeps();

    await expect(run(deps, { ...world.job, tries: 2 }, 0)).resolves.toBeUndefined();

    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'AI_FAILED' });
    expect((await attemptsOf(world.submission.id)).map((a) => a.attemptNo)).toEqual([3]);
  });

  it('sends the submission to manual review when the last try gets an answer that is not a valid grade', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-malformed-json__.png'] });
    const { deps } = makeDeps();

    await expect(run(deps, world.job, 2)).resolves.toBeUndefined();

    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'AI_FAILED' });
  });

  it('sends the submission to manual review when the last try fails before Gemini is called, for example storage is down', async () => {
    const world = await seedWorld();
    const { deps, grade } = makeDeps();
    const brokenStorage = { ...storage, get: vi.fn().mockRejectedValue(new Error('the disk is gone')) };

    await expect(run({ ...deps, storage: brokenStorage }, world.job, 2)).resolves.toBeUndefined();

    expect(grade).not.toHaveBeenCalled();
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'AI_FAILED' });
  });

  it('gives a failure before Gemini is called the earlier tries too: it throws until the last', async () => {
    const world = await seedWorld();
    const { deps } = makeDeps();
    const brokenStorage = { ...storage, get: vi.fn().mockRejectedValue(new Error('the disk is gone')) };

    await expect(run({ ...deps, storage: brokenStorage }, world.job, 1)).rejects.toThrow('the disk is gone');

    expect((await submissionOf(world.submission.id)).state).toBe('GRADING');
  });

  it('does not retry a key or file problem: the job finishes on the first try with the cause', async () => {
    const world = await seedWorld({ fileNames: ['__scenario-file-quality__.png'] });
    const { deps, grade } = makeDeps();

    await expect(run(deps, world.job, 0)).resolves.toBeUndefined();

    expect(grade).toHaveBeenCalledTimes(1);
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: 'FILE_QUALITY' });
  });

  it('does not demote a graded submission when a duplicate job reaches its last try', async () => {
    const world = await seedWorld();
    await gradeSubmission(makeDeps().deps, world.job, { attemptNo: 1 });
    const failing = makeDeps({ grade: async () => { throw new GeminiError('TRANSIENT'); } });

    await expect(run(failing.deps, world.job, 2)).resolves.toBeUndefined();

    expect(failing.grade).not.toHaveBeenCalled();
    expect(await submissionOf(world.submission.id)).toMatchObject({ state: 'AI_GENERATED', manualReviewCause: null });
  });

  it('sends the job again with the tries used so far when the instructor has no token', async () => {
    const world = await seedWorld();
    const send = vi.fn();
    const { deps, grade } = makeDeps({ pacer: { take: vi.fn(() => 7) } });

    await run(deps, { ...world.job, tries: 1 }, 1, send);

    expect(grade).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(GRADE_SUBMISSION, { ...world.job, tries: 2 }, { singletonKey: `grade:${world.job.submissionId}`, startAfter: 7 });
    expect((await submissionOf(world.submission.id)).state).toBe('QUEUED');
  });
});
