import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGemini, GeminiError, PROMPT_VERSION, type GeminiAdapter } from '@edugemini/ai';
import { TERMS_VERSION, type GradeJob } from '@edugemini/shared';
import { createLocalStorage } from '../lib/local-storage';
import { createLogger } from '../lib/logger';
import type { Pacer } from '../lib/pacing';
import { createTestDb } from '../test/test-db';
import { newJoinCode } from './class-service';
import { gradeSubmission, type GradingDeps } from './grading-service';
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
  it.each([
    ['timeout-always', 'TRANSIENT_ERROR', 'TRANSIENT'],
    ['key-invalid', 'KEY_ERROR', 'KEY_INVALID'],
    ['quota-daily', 'QUOTA_ERROR', 'QUOTA'],
  ] as const)('records the %s scenario as %s and throws, so the job is tried again', async (scenario, outcome, errorClass) => {
    const world = await seedWorld({ fileNames: [`__scenario-${scenario}__.png`] });
    const { deps } = makeDeps();

    await expect(gradeSubmission(deps, world.job, { attemptNo: 2 })).rejects.toBeInstanceOf(GeminiError);

    expect(await attemptsOf(world.submission.id)).toMatchObject([{ attemptNo: 2, outcome, errorClass, model: 'fake' }]);
    expect(await gradesOf(world.submission.id)).toHaveLength(0);
    expect((await submissionOf(world.submission.id)).state).toBe('GRADING');
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
