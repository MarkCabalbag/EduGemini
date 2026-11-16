import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  Prisma,
  type Assignment,
  type PrismaClient,
  type SubmissionFile,
  type SubmissionState,
  type SubmissionVersion,
} from '@prisma/client';
import {
  LIMITS,
  SNIFF_BYTES,
  sniffFileType,
  type DisplayState,
  type FileView,
  type StudentSubmission,
  type VersionView,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { lockSubmission } from '../lib/lock';
import { countPdfPages } from '../lib/pdf-pages';
import { measure, type StorageAdapter } from '../lib/storage';
import { authorize, type Actor } from '../policy/policy';
import { enrollmentOf } from './assignment-service';

/**
 * A student's submission, the three steps of API Spec A7: open a version, send its files, finalize. Finalize makes the
 * submission and queues it, but nothing grades yet (the grading job comes with AI-08), and the lock after approval (SUB-08) comes
 * with its ticket. Open and finalize both refuse late work when it is closed (SUB-06).
 */

const toVersionView = (row: SubmissionVersion): VersionView => ({
  id: row.id,
  versionNo: row.versionNo,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  storedAt: row.storedAt?.toISOString() ?? null,
});

const toFileView = (row: SubmissionFile): FileView => ({
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

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Resubmissions left, or null when the assignment allows unlimited (Backend Schema §8.1). */
const attemptsLeft = (maxResubmissions: number | null, extraAttempts: number, used: number): number | null =>
  maxResubmissions === null ? null : Math.max(0, maxResubmissions + extraAttempts - used);

/** Past due, late work not accepted, and the instructor has not let this student in (Backend Schema §8.1, `is_closed`). */
const isClosed = (assignment: Pick<Assignment, 'acceptLate' | 'dueAt'>, lateAllowed: boolean): boolean =>
  !assignment.acceptLate && Date.now() > assignment.dueAt.getTime() && !lateAllowed;

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

/** The lowest position in the version that no file holds, so a removed file's place is used again. */
function firstFreeOrdinal(files: { ordinal: number }[]): number {
  const used = new Set(files.map((file) => file.ordinal));
  for (let ordinal = 1; ordinal <= LIMITS.filesPerSubmission; ordinal++) {
    if (!used.has(ordinal)) return ordinal;
  }
  throw new AppError('FILE_LIMIT', { details: { limit: 'files' } });
}

async function readHead(path: string): Promise<Buffer> {
  const file = await open(path);
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Store one file in the student's open version (API Spec SUB-03, TRD §9.1). The bytes go to a temporary file first, with
 * the size cap enforced while they arrive, so the type is known before anything reaches storage. Sending the same
 * `clientFileId` again replaces that file: the old object is queued for deletion and the row keeps its place. A file
 * refused for any reason stores nothing. HEIC comes with SUB-03.
 */
export async function storeFile(
  db: PrismaClient,
  storage: StorageAdapter,
  bucket: string,
  actor: Actor,
  versionId: string,
  clientFileId: string,
  upload: { body: Readable; displayName: string },
): Promise<{ created: boolean; file: FileView }> {
  const version = await db.submissionVersion.findUnique({
    where: { id: versionId },
    include: { files: true, submission: { select: { studentId: true, assignmentId: true, assignment: { select: { classId: true } } } } },
  });
  if (!version || version.submission.studentId !== actor.id) throw new AppError('NOT_FOUND');
  const { assignmentId, assignment } = version.submission;
  authorize(actor, 'submission.upload', { enrollment: await enrollmentOf(db, actor, assignment.classId) });
  if (version.status !== 'UPLOADING') throw new AppError('UPLOAD_NOT_OPEN');

  const existing = version.files.find((file) => file.clientFileId === clientFileId);
  const ordinal = existing?.ordinal ?? firstFreeOrdinal(version.files); // a count over the limit is refused before the body is read

  const dir = await mkdtemp(join(tmpdir(), 'edugemini-upload-'));
  try {
    const temp = join(dir, 'upload');
    await pipeline(measure(upload.body, LIMITS.maxFileBytes).stream, createWriteStream(temp));
    const kind = sniffFileType(await readHead(temp));
    if (!kind) throw new AppError('FILE_TYPE');

    // The total counts the other files in the version, not the one being replaced. Two files arriving at the same moment
    // can both pass this check, so finalize (SUB-05) checks the total again.
    const others = version.files.filter((file) => file.id !== existing?.id);
    const totalBytes = others.reduce((sum, file) => sum + Number(file.sizeBytes ?? 0), (await stat(temp)).size);
    if (totalBytes > LIMITS.maxSubmissionBytes) throw new AppError('FILE_LIMIT', { details: { limit: 'total-size' } });
    const pageCount = kind.mimeType === 'application/pdf' ? await countPdfPages(temp) : null;

    // Built from IDs and the sniffed type, never from the file's name (code-standards §9). A replacement gets a new path.
    const path = `submissions/${assignment.classId}/${assignmentId}/${actor.id}/${versionId}/${ordinal}-${randomUUID()}.${kind.extension}`;
    const stored = await storage.put(bucket, path, createReadStream(temp), kind.mimeType, LIMITS.maxFileBytes);
    const fields = {
      status: 'STORED',
      storagePath: path,
      displayName: upload.displayName,
      mimeType: kind.mimeType,
      sizeBytes: stored.size,
      pageCount,
      sha256: stored.sha256,
      failureCode: null,
    } as const;

    try {
      if (!existing) {
        const row = await db.submissionFile.create({ data: { versionId, clientFileId, ordinal, ...fields } });
        return { created: true, file: toFileView(row) };
      }
      const row = await db.$transaction(async (tx) => {
        const updated = await tx.submissionFile.update({ where: { id: existing.id }, data: fields });
        if (existing.storagePath) {
          const objectPath = existing.storagePath;
          await tx.storageDeletion.upsert({ where: { bucket_objectPath: { bucket, objectPath } }, create: { bucket, objectPath }, update: {} });
        }
        return updated;
      });
      return { created: false, file: toFileView(row) };
    } catch (error) {
      // No object without a row. A failed removal only leaves an unreferenced object, so it does not hide the real error.
      await storage.remove(bucket, [path]).catch(() => undefined);
      throw isUniqueViolation(error) ? new AppError('CONFLICT') : error; // the same file sent twice at the same moment
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Remove one file from the student's open upload (API Spec SUB-04). The row goes and its object is queued for deletion.
 * A file that is already gone is not an error. It runs on the locked submission row, as finalize does, so a finalize at
 * the same moment either sees the file or finds it gone, and never loses a file from a version that is already stored.
 */
export async function removeFile(db: PrismaClient, bucket: string, actor: Actor, versionId: string, clientFileId: string): Promise<void> {
  const found = await db.submissionVersion.findUnique({
    where: { id: versionId },
    include: { submission: { select: { studentId: true, assignment: { select: { classId: true } } } } },
  });
  if (!found || found.submission.studentId !== actor.id) throw new AppError('NOT_FOUND');
  authorize(actor, 'submission.upload', { enrollment: await enrollmentOf(db, actor, found.submission.assignment.classId) });

  await db.$transaction(async (tx) => {
    await lockSubmission(tx, found.submissionId);
    const version = await tx.submissionVersion.findUniqueOrThrow({ where: { id: versionId }, include: { files: { where: { clientFileId } } } });
    if (version.status !== 'UPLOADING') throw new AppError('UPLOAD_NOT_OPEN');
    const [file] = version.files;
    if (!file) return;
    if (file.storagePath) await tx.storageDeletion.createMany({ data: [{ bucket, objectPath: file.storagePath }], skipDuplicates: true });
    await tx.submissionFile.delete({ where: { id: file.id } });
  });
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
      const objectPaths = version.files.flatMap((file) => (file.storagePath ? [file.storagePath] : []));
      await tx.storageDeletion.createMany({ data: objectPaths.map((objectPath) => ({ bucket, objectPath })), skipDuplicates: true });
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
 * resubmission uses one attempt and removes the previous version's files. Nothing enqueues grading yet (AI-08).
 */
export async function finalizeVersion(
  db: PrismaClient,
  bucket: string,
  actor: Actor,
  versionId: string,
  expectedFileIds: string[],
): Promise<StudentSubmission> {
  const found = await db.submissionVersion.findUnique({
    where: { id: versionId },
    include: { submission: { include: { assignment: { select: { classId: true } } } } },
  });
  if (!found || found.submission.studentId !== actor.id) throw new AppError('NOT_FOUND');
  authorize(actor, 'submission.upload', { enrollment: await enrollmentOf(db, actor, found.submission.assignment.classId) });

  return db.$transaction(async (tx) => {
    await lockSubmission(tx, found.submissionId);
    const submission = await tx.submission.findUniqueOrThrow({ where: { id: found.submissionId } });
    const version = await tx.submissionVersion.findUniqueOrThrow({ where: { id: versionId }, include: { files: true } });
    const assignment = await tx.assignment.findUniqueOrThrow({
      where: { id: submission.assignmentId },
      include: { class: { select: { archivedAt: true } }, referenceFiles: { select: { sizeBytes: true } } },
    });

    // A second finalize of the version that is already stored gives the same answer and changes nothing.
    if (version.status === 'STORED') return studentSubmissionOf(tx, actor.id, assignment);
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

    // Files that leave: the ones not listed and the previous version's. Their objects go to the outbox (Backend Schema §10.2a).
    const leaving = previousId ? [...dropped, ...(await tx.submissionFile.findMany({ where: { versionId: previousId } }))] : dropped;
    const objectPaths = leaving.flatMap((file) => (file.storagePath ? [file.storagePath] : []));
    await tx.storageDeletion.createMany({ data: objectPaths.map((objectPath) => ({ bucket, objectPath })), skipDuplicates: true });
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
        currentVersionId: version.id,
        latestSubmittedAt: now,
        firstSubmittedAt: submission.firstSubmittedAt ?? now,
        resubmissionsUsed: previousId ? { increment: 1 } : undefined,
      },
    });
    return studentSubmissionOf(tx, actor.id, assignment);
  });
}
