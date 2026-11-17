import type { Assignment, Prisma, PrismaClient, SubmissionFile, SubmissionState, SubmissionVersion } from '@prisma/client';
import { LIMITS, type DisplayState, type FileView, type GradeJob, type GradeView, type StudentSubmission, type VersionView } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { lockSubmission } from '../lib/lock';
import { isUniqueViolation } from '../lib/prisma-errors';
import { queueDeletions } from '../lib/storage';
import { authorize, type Actor } from '../policy/policy';
import { enrollmentOf } from './assignment-service';
import type { EnqueueGrading } from './grading-service';

/**
 * A student's submission, the three steps of API Spec A7: open a version, send its files (`submission-file-service.ts`),
 * finalize. Finalize makes the submission, queues it and starts the grading job (AI-08), and the lock after approval (SUB-08)
 * comes with its ticket. Open and finalize both refuse late work when it is closed (SUB-06).
 */

const toVersionView = (row: SubmissionVersion): VersionView => ({
  id: row.id,
  versionNo: row.versionNo,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  storedAt: row.storedAt?.toISOString() ?? null,
});

export const toFileView = (row: SubmissionFile): FileView => ({
  id: row.id,
  clientFileId: row.clientFileId,
  ordinal: row.ordinal,
  displayName: row.displayName ?? 'file',
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
  pageCount: row.pageCount,
  status: row.status,
  failureCode: row.failureCode,
});

/** Resubmissions left, or null when the assignment allows unlimited (Backend Schema §8.1). */
const attemptsLeft = (maxResubmissions: number | null, extraAttempts: number, used: number): number | null =>
  maxResubmissions === null ? null : Math.max(0, maxResubmissions + extraAttempts - used);

/** Past due, late work not accepted, and the instructor has not let this student in (Backend Schema §8.1, `is_closed`). */
const isClosed = (assignment: Pick<Assignment, 'acceptLate' | 'dueAt'>, lateAllowed: boolean): boolean =>
  !assignment.acceptLate && Date.now() > assignment.dueAt.getTime() && !lateAllowed;

/**
 * The version, with its files, if it is the caller's own and the caller may still upload in the class. Anyone else's
 * version looks the same as a missing one.
 */
export async function ownVersion(db: PrismaClient, actor: Actor, versionId: string) {
  const version = await db.submissionVersion.findUnique({
    where: { id: versionId },
    include: { files: true, submission: { include: { assignment: { select: { classId: true } } } } },
  });
  if (!version || version.submission.studentId !== actor.id) throw new AppError('NOT_FOUND');
  authorize(actor, 'submission.upload', { enrollment: await enrollmentOf(db, actor, version.submission.assignment.classId) });
  return version;
}


/**
 * Open an upload for the student (API Spec SUB-02). While one is open, asking again gives that same one. The database
 * allows one open version per submission, so two taps at the same moment also end up with the same version.
 */
export async function openVersion(
  db: PrismaClient,
  actor: Actor,
  assignmentId: string,
): Promise<{ created: boolean; version: VersionView }> {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { archivedAt: true } } },
  });
  if (!assignment) throw new AppError('NOT_FOUND');
  // The student's class membership first: a pending student is told so, anyone else outside the class sees nothing.
  authorize(actor, 'submission.upload', { enrollment: await enrollmentOf(db, actor, assignment.classId) });
  if (assignment.status !== 'PUBLISHED') throw new AppError('NOT_FOUND'); // a draft looks the same as a missing one
  if (assignment.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  // Checked before anything is created or returned: a refused student gets no submission row, and an upload that was open
  // when the due date passed cannot go on.
  const earlier = await db.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId: actor.id } },
    select: { lateAllowed: true },
  });
  if (isClosed(assignment, earlier?.lateAllowed ?? false)) throw new AppError('LATE_CLOSED');

  const findOpen = () =>
    db.submissionVersion.findFirst({ where: { status: 'UPLOADING', submission: { assignmentId, studentId: actor.id } } });
  const open = await findOpen();
  if (open) return { created: false, version: toVersionView(open) };

  const submission = await db.submission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId: actor.id } },
    create: { assignmentId, studentId: actor.id },
    update: {},
  });
  // A student who has submitted and has no resubmissions left cannot open another upload (finalize checks again).
  if (submission.currentVersionId && attemptsLeft(assignment.maxResubmissions, submission.extraAttempts, submission.resubmissionsUsed) === 0) {
    throw new AppError('ATTEMPTS_EXHAUSTED');
  }
  const last = await db.submissionVersion.findFirst({
    where: { submissionId: submission.id },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });
  try {
    const row = await db.submissionVersion.create({ data: { submissionId: submission.id, versionNo: (last?.versionNo ?? 0) + 1 } });
    return { created: true, version: toVersionView(row) };
  } catch (error) {
    const raced = isUniqueViolation(error) ? await findOpen() : null;
    if (!raced) throw error;
    return { created: false, version: toVersionView(raced) };
  }
}

/** An upload left open this long is abandoned (TRD §9.3). */
const STAGED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete uploads that were opened more than 24 hours ago and never finalized, with their files (TRD §12, `staged.cleanup`).
 * The objects go to the storage outbox. Each upload is checked again on its locked submission row, so one that was
 * finalized in the meantime is left alone. The submission row stays: an instructor's allowance may be on it. Returns how many
 * uploads were deleted. The `staged.cleanup` job (`jobs/staged-cleanup.job.ts`) runs it at start and every hour.
 */
export async function deleteStagedUploads(db: PrismaClient, bucket: string, now = new Date()): Promise<number> {
  const stale = await db.submissionVersion.findMany({
    where: { status: 'UPLOADING', createdAt: { lt: new Date(now.getTime() - STAGED_MAX_AGE_MS) } },
    select: { id: true, submissionId: true },
  });
  let deleted = 0;
  for (const { id, submissionId } of stale) {
    await db.$transaction(async (tx) => {
      await lockSubmission(tx, submissionId);
      const version = await tx.submissionVersion.findFirst({ where: { id, status: 'UPLOADING' }, include: { files: true } });
      if (!version) return;
      await queueDeletions(tx, bucket, version.files);
      await tx.submissionVersion.delete({ where: { id } }); // its files go with it
      deleted++;
    });
  }
  return deleted;
}

// The student's view of the database state (API Spec A5). Causes and internal states never reach the student.
const DISPLAY_STATE: Record<SubmissionState, DisplayState> = {
  QUEUED: 'GRADING',
  GRADING: 'GRADING',
  AI_GENERATED: 'AI_GENERATED',
  NEEDS_MANUAL_REVIEW: 'AWAITING_REVIEW',
  INSTRUCTOR_APPROVED: 'INSTRUCTOR_APPROVED',
};

/**
 * The grade the student sees: the active grade, only while the submission is `AI_GENERATED` or `INSTRUCTOR_APPROVED`.
 * Nothing but the score, the feedback and the chip goes out: no model, prompt version, confidence or cause (API Spec A5).
 */
async function gradeViewOf(
  db: Prisma.TransactionClient,
  submission: { state: SubmissionState | null; activeGradeId: string | null },
  assignment: Pick<Assignment, 'maxScore' | 'scoringFormat'>,
): Promise<GradeView | null> {
  const { state, activeGradeId } = submission;
  if ((state !== 'AI_GENERATED' && state !== 'INSTRUCTOR_APPROVED') || !activeGradeId) return null;
  const grade = await db.gradeResult.findUnique({ where: { id: activeGradeId } });
  if (!grade || grade.score === null) return null;
  const score = Number(grade.score);
  const maxScore = Number(assignment.maxScore);
  return {
    source: grade.source,
    score,
    maxScore,
    scoringFormat: assignment.scoringFormat,
    letter: grade.letter,
    percentage: Math.round((score / maxScore) * 100),
    feedback: grade.feedback ?? '',
    chip: state === 'INSTRUCTOR_APPROVED' ? 'status-approved' : 'status-ai',
  };
}

/**
 * The student's own submission for one assignment (API Spec SUB-01), read through `db`, which may be a transaction.
 * `UPLOADING` shows only while nothing is stored yet; after that the state is the submission's, and an upload opened
 * for a resubmission is `draftVersion`. `closed` is reported here and refused by `openVersion` and `finalizeVersion`.
 */
async function studentSubmissionOf(db: Prisma.TransactionClient, studentId: string, assignment: Assignment): Promise<StudentSubmission> {
  const submission = await db.submission.findUnique({ where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } } });
  const draft = submission
    ? await db.submissionVersion.findFirst({
        where: { submissionId: submission.id, status: 'UPLOADING' },
        include: { files: { orderBy: { ordinal: 'asc' } } },
      })
    : null;
  const current = submission?.currentVersionId
    ? await db.submissionVersion.findUnique({ where: { id: submission.currentVersionId }, include: { files: { orderBy: { ordinal: 'asc' } } } })
    : null;

  const latest = submission?.latestSubmittedAt ?? null;
  const left = attemptsLeft(assignment.maxResubmissions, submission?.extraAttempts ?? 0, submission?.resubmissionsUsed ?? 0);
  return {
    state: submission?.state ? DISPLAY_STATE[submission.state] : draft ? 'UPLOADING' : 'NOT_SUBMITTED',
    isLate: latest !== null && latest > assignment.dueAt,
    closed: isClosed(assignment, submission?.lateAllowed ?? false),
    attemptsLeft: left,
    unlimited: left === null,
    firstSubmittedAt: submission?.firstSubmittedAt?.toISOString() ?? null,
    latestSubmittedAt: latest?.toISOString() ?? null,
    files: current?.files.map(toFileView) ?? [],
    grade: submission ? await gradeViewOf(db, submission, assignment) : null,
    instructorComment: submission?.state === 'INSTRUCTOR_APPROVED' ? submission.instructorComment : null,
    draftVersion: draft ? { ...toVersionView(draft), files: draft.files.map(toFileView) } : null,
  };
}

/** The student's own submission (API Spec SUB-01). Access is the same as for reading the assignment: an approved student, a published assignment. */
export async function getMySubmission(db: PrismaClient, actor: Actor, assignmentId: string): Promise<StudentSubmission> {
  const assignment = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw new AppError('NOT_FOUND');
  authorize(actor, 'assignment.view', { enrollment: await enrollmentOf(db, actor, assignment.classId) });
  if (assignment.status !== 'PUBLISHED') throw new AppError('NOT_FOUND');
  return studentSubmissionOf(db, actor.id, assignment);
}

/**
 * Finalize an upload (API Spec SUB-05): the open version becomes the submission's current one and the submission is queued
 * for grading. Everything runs in one transaction on the locked submission row, so two taps, or a finalize racing another
 * write, run one after the other. The listed files are the final set (a stored file that is not listed is dropped), and a
 * resubmission uses one attempt and removes the previous version's files. The grading job is sent after the transaction has
 * committed, so the worker never looks for a version that does not exist yet. A repeat finalize sends nothing (AI-08).
 */
export async function finalizeVersion(
  db: PrismaClient,
  bucket: string,
  actor: Actor,
  versionId: string,
  expectedFileIds: string[],
  enqueueGrading: EnqueueGrading,
): Promise<StudentSubmission> {
  const { submissionId } = await ownVersion(db, actor, versionId);

  const { view, job } = await db.$transaction(async (tx): Promise<{ view: StudentSubmission; job: GradeJob | null }> => {
    await lockSubmission(tx, submissionId);
    const submission = await tx.submission.findUniqueOrThrow({ where: { id: submissionId } });
    const version = await tx.submissionVersion.findUniqueOrThrow({ where: { id: versionId }, include: { files: true } });
    const assignment = await tx.assignment.findUniqueOrThrow({
      where: { id: submission.assignmentId },
      include: { class: { select: { archivedAt: true } }, referenceFiles: { select: { sizeBytes: true } } },
    });

    // A second finalize of the version that is already stored gives the same answer and changes nothing.
    if (version.status === 'STORED') return { view: await studentSubmissionOf(tx, actor.id, assignment), job: null };
    if (version.status !== 'UPLOADING') throw new AppError('UPLOAD_NOT_OPEN');
    if (assignment.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
    if (isClosed(assignment, submission.lateAllowed)) throw new AppError('LATE_CLOSED');

    const listed = new Set(expectedFileIds);
    const missing = expectedFileIds.filter((id) => version.files.find((file) => file.clientFileId === id)?.status !== 'STORED');
    if (missing.length > 0) throw new AppError('UPLOAD_INCOMPLETE', { details: { missing } });
    const kept = version.files.filter((file) => listed.has(file.clientFileId));
    const dropped = version.files.filter((file) => !listed.has(file.clientFileId));

    // Each file was checked when it arrived; the total is checked again here because two files can arrive at the same moment.
    const filesBytes = kept.reduce((sum, file) => sum + Number(file.sizeBytes ?? 0), 0);
    if (filesBytes > LIMITS.maxSubmissionBytes) throw new AppError('FILE_LIMIT', { details: { limit: 'total-size' } });
    const referenceBytes = assignment.referenceFiles.reduce((sum, file) => sum + Number(file.sizeBytes), 0);
    if (filesBytes + referenceBytes > LIMITS.maxSubmissionBytes) throw new AppError('FILE_LIMIT', { details: { limit: 'grading-budget' } });

    const previousId = submission.currentVersionId;
    if (previousId && attemptsLeft(assignment.maxResubmissions, submission.extraAttempts, submission.resubmissionsUsed) === 0) {
      throw new AppError('ATTEMPTS_EXHAUSTED');
    }

    // Files that leave: the ones not listed and the previous version's.
    const leaving = previousId ? [...dropped, ...(await tx.submissionFile.findMany({ where: { versionId: previousId } }))] : dropped;
    await queueDeletions(tx, bucket, leaving);
    await tx.submissionFile.deleteMany({ where: { id: { in: leaving.map((file) => file.id) } } });
    // The list is in the order shown to the student, so the files take that order. A removed or retried file leaves gaps in the places.
    for (const [index, clientFileId] of expectedFileIds.entries()) {
      await tx.submissionFile.update({ where: { versionId_clientFileId: { versionId: version.id, clientFileId } }, data: { ordinal: index + 1 } });
    }
    if (previousId) await tx.submissionVersion.update({ where: { id: previousId }, data: { status: 'REPLACED' } });

    const now = new Date();
    await tx.submissionVersion.update({ where: { id: version.id }, data: { status: 'STORED', storedAt: now } });
    await tx.submission.update({
      where: { id: submission.id },
      data: {
        state: 'QUEUED',
        manualReviewCause: null, // a resubmission after manual review starts again (the cause belongs to that state only)
        activeGradeId: previousId ? null : undefined, // the old grade belongs to the old version (TRD §5.4); the grading job supersedes it
        currentVersionId: version.id,
        latestSubmittedAt: now,
        firstSubmittedAt: submission.firstSubmittedAt ?? now,
        resubmissionsUsed: previousId ? { increment: 1 } : undefined,
      },
    });
    const job: GradeJob = { submissionId: submission.id, versionId: version.id, mode: previousId ? 'resubmit' : 'first' };
    return { view: await studentSubmissionOf(tx, actor.id, assignment), job };
  });

  if (job) await enqueueGrading(job);
  return view;
}
