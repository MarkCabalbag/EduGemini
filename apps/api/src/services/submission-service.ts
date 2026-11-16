import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Prisma, type PrismaClient, type SubmissionFile, type SubmissionVersion } from '@prisma/client';
import { LIMITS, SNIFF_BYTES, sniffFileType, type FileView, type VersionView } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { countPdfPages } from '../lib/pdf-pages';
import { measure, type StorageAdapter } from '../lib/storage';
import { authorize, type Actor } from '../policy/policy';
import { enrollmentOf } from './assignment-service';

/**
 * Uploading a submission, steps 1 and 2 of API Spec A7: open a version, then send its files. Finalizing is SUB-05, so
 * nothing here makes a submission or starts grading, and the limits on attempts and late work come with their tickets.
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
  ordinal: row.ordinal,
  displayName: row.displayName ?? 'file',
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
  pageCount: row.pageCount,
  status: row.status,
  failureCode: row.failureCode,
});

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

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

  const findOpen = () =>
    db.submissionVersion.findFirst({ where: { status: 'UPLOADING', submission: { assignmentId, studentId: actor.id } } });
  const open = await findOpen();
  if (open) return { created: false, version: toVersionView(open) };

  const submission = await db.submission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId: actor.id } },
    create: { assignmentId, studentId: actor.id },
    update: {},
  });
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
