import { buffer } from 'node:stream/consumers';
import type { AttemptOutcome, ManualReviewCause, Prisma, PrismaClient } from '@prisma/client';
import { GeminiError, PROMPT_VERSION, type GeminiAdapter, type GradeFile } from '@edugemini/ai';
import { GradeOutputSchema, type GradeJob, type GradeOutput } from '@edugemini/shared';
import type { Env } from '../lib/env';
import { lockSubmission } from '../lib/lock';
import type { Logger } from '../lib/logger';
import type { Pacer } from '../lib/pacing';
import type { StorageAdapter } from '../lib/storage';
import { loadKeyForGrading } from './key-service';
import { notify } from './notification-service';

export type GradingDeps = {
  db: PrismaClient;
  storage: StorageAdapter;
  bucket: string;
  gemini: GeminiAdapter;
  pacer: Pacer;
  env: Pick<Env, 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_VERSION'>;
  logger: Logger;
};

/** What finalize calls to start grading (AI-08). It does not throw: the submission is already stored and queued. */
export type EnqueueGrading = (job: GradeJob) => Promise<void>;

/** One run of a `grade.submission` job: its try number (1 for the first), the job's shutdown signal, and the Gemini timeout. */
export type GradingRun = { attemptNo: number; signal?: AbortSignal; timeoutMs?: number };

/** Why a Gemini call failed, as the outcome and class stored on its `GradingAttempt` (Backend Schema §4.17, TRD §10.7). */
function failureOf(error: unknown): { outcome: AttemptOutcome; errorClass: string } {
  if (error instanceof GeminiError) {
    if (error.kind === 'TRANSIENT') return { outcome: 'TRANSIENT_ERROR', errorClass: error.kind };
    return { outcome: error.kind === 'QUOTA' ? 'QUOTA_ERROR' : 'KEY_ERROR', errorClass: error.kind };
  }
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return { outcome: 'TRANSIENT_ERROR', errorClass: timedOut ? 'TIMEOUT' : 'UNKNOWN' };
}

/** What Gemini answered, or null when it is not JSON, does not match `GradeOutput`, or the score is outside 0 to the maximum (TRD §10.6). */
function parseAnswer(raw: string, maxScore: number): GradeOutput | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = GradeOutputSchema.safeParse(json);
  return parsed.success && parsed.data.score >= 0 && parsed.data.score <= maxScore ? parsed.data : null;
}

/**
 * Send the submission to the instructor for manual review, with the reason. Nothing happens when the version is no longer the
 * current one: the single UPDATE checks it, so a newer submission is never moved. Grading retries (AI-06) use this too.
 */
export async function moveToManualReview(db: PrismaClient, job: Pick<GradeJob, 'submissionId' | 'versionId'>, cause: ManualReviewCause): Promise<void> {
  await db.submission.updateMany({
    where: { id: job.submissionId, currentVersionId: job.versionId },
    data: { state: 'NEEDS_MANUAL_REVIEW', manualReviewCause: cause },
  });
}

/**
 * Grade one submission (TRD §10.3). Returns `{ waitSeconds }` when the instructor's key has no token yet, so the caller sends
 * the job again later, and nothing otherwise. A failed Gemini call is recorded and thrown, so pg-boss retries the job; what
 * happens after the last try is AI-06. Only `first` and `resubmit` work for now: the other modes come with their tickets.
 */
export async function gradeSubmission(deps: GradingDeps, job: GradeJob, { attemptNo, signal, timeoutMs = 60_000 }: GradingRun): Promise<{ waitSeconds: number } | undefined> {
  const { db, storage, bucket, gemini, pacer, env, logger } = deps;
  if (job.mode === 'regrade_approved') throw new Error('The mode regrade_approved is not built until REV-09.');

  // 1. Load the submission. A job for a submission that is gone, or for a version that is no longer the current one, ends here.
  const submission = await db.submission.findUnique({
    where: { id: job.submissionId },
    include: { assignment: { include: { class: { select: { name: true, instructorId: true } } } } },
  });
  if (!submission) return;
  const { assignment } = submission;

  const record = async (client: Prisma.TransactionClient, outcome: AttemptOutcome, extra: { errorClass?: string; latencyMs?: number; model?: string } = {}) => {
    await client.gradingAttempt.create({ data: { submissionId: job.submissionId, versionId: job.versionId, attemptNo, outcome, ...extra } });
    logger.info({ event: 'grading.attempt', submissionId: job.submissionId, attemptNo, outcome, ...extra });
  };

  if (submission.currentVersionId !== job.versionId) {
    await record(db, 'STALE_DISCARDED');
    return;
  }

  // 2. The key. Without a usable one Gemini is not called, and nothing is retried.
  const key = await loadKeyForGrading(db, env, assignment.class.instructorId);
  if ('problem' in key) {
    await moveToManualReview(db, job, key.problem);
    logger.info({ event: 'grading.manual_review', submissionId: job.submissionId, cause: key.problem });
    return;
  }

  // 3. A pacing token for this instructor's key.
  const waitSeconds = pacer.take(assignment.class.instructorId);
  if (waitSeconds > 0) return { waitSeconds };

  // 4. The request: the assignment and the student's files in order (never a name, an ID or an email, TRD §10.4).
  await db.submission.updateMany({ where: { id: job.submissionId, currentVersionId: job.versionId }, data: { state: 'GRADING' } });
  const files = await db.submissionFile.findMany({ where: { versionId: job.versionId, status: 'STORED' }, orderBy: { ordinal: 'asc' } });
  const studentFiles: GradeFile[] = [];
  for (const file of files) {
    // A stored file always has its object and type. `displayName` is for the fake adapter only.
    studentFiles.push({ mimeType: file.mimeType!, displayName: file.displayName ?? 'file', data: await buffer(await storage.get(bucket, file.storagePath!)) });
  }
  const maxScore = Number(assignment.maxScore);

  const started = Date.now();
  let answer: string;
  try {
    answer = await gemini.grade(
      {
        assignment: { title: assignment.title, instructions: assignment.instructions, criteriaText: assignment.criteriaText, scoringFormat: assignment.scoringFormat, maxScore },
        studentFiles,
      },
      key.apiKey,
      { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]) },
    );
  } catch (error) {
    const { outcome, errorClass } = failureOf(error);
    await record(db, outcome, { errorClass, latencyMs: Date.now() - started, model: gemini.model });
    throw error;
  }
  const latencyMs = Date.now() - started;

  // 5. An answer that cannot be used is a transient error, so the job is tried again.
  const output = parseAnswer(answer, maxScore);
  if (!output) {
    await record(db, 'TRANSIENT_ERROR', { errorClass: 'INVALID_OUTPUT', latencyMs, model: gemini.model });
    throw new Error('Gemini gave an answer that is not a valid grade.');
  }

  // 6. Store the result on the locked submission row, unless a newer version arrived while Gemini was working.
  await db.$transaction(async (tx) => {
    await lockSubmission(tx, job.submissionId);
    const current = await tx.submission.findUniqueOrThrow({ where: { id: job.submissionId }, select: { currentVersionId: true } });
    if (current.currentVersionId !== job.versionId) {
      await record(tx, 'STALE_DISCARDED', { latencyMs, model: gemini.model });
      return;
    }
    await tx.gradeResult.updateMany({ where: { submissionId: job.submissionId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    const grade = await tx.gradeResult.create({
      data: {
        submissionId: job.submissionId,
        versionId: job.versionId,
        source: 'AI',
        status: 'ACTIVE',
        score: output.score,
        feedback: output.feedback,
        criteriaVersion: assignment.criteriaVersion,
        model: gemini.model,
        promptVersion: PROMPT_VERSION,
        confidence: output.confidence,
        readabilityIssue: output.readabilityIssue,
      },
    });
    await tx.submission.update({ where: { id: job.submissionId }, data: { activeGradeId: grade.id, state: 'AI_GENERATED', manualReviewCause: null } });
    await notify(tx, 'SUBMISSION_GRADED', [submission.studentId], { link: `/assignments/${assignment.id}`, className: assignment.class.name });
    // 7. The attempt is recorded in the same transaction, so a result never exists without it.
    await record(tx, 'SUCCESS', { latencyMs, model: gemini.model });
  });
}
