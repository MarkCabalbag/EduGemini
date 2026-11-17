import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PrismaClient } from '@prisma/client';
import { LIMITS, sniffFileType, type FileView } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { lockSubmission } from '../lib/lock';
import { countPdfPages } from '../lib/pdf-pages';
import { isUniqueViolation } from '../lib/prisma-errors';
import { measure, queueDeletions, readHead, type StorageAdapter } from '../lib/storage';
import type { Actor } from '../policy/policy';
import { ownVersion, toFileView } from './submission-service';

/** One file in a student's open upload: send it, or take it out (API Spec SUB-03, SUB-04). */

/** The lowest position in the version that no file holds, so a removed file's place is used again. */
function firstFreeOrdinal(files: { ordinal: number }[]): number {
  const used = new Set(files.map((file) => file.ordinal));
  for (let ordinal = 1; ordinal <= LIMITS.filesPerSubmission; ordinal++) {
    if (!used.has(ordinal)) return ordinal;
  }
  throw new AppError('FILE_LIMIT', { details: { limit: 'files' } });
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
  const version = await ownVersion(db, actor, versionId);
  const { assignmentId, assignment } = version.submission;
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
        await queueDeletions(tx, bucket, [existing]);
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
  const { submissionId } = await ownVersion(db, actor, versionId);

  await db.$transaction(async (tx) => {
    await lockSubmission(tx, submissionId);
    const version = await tx.submissionVersion.findUniqueOrThrow({ where: { id: versionId }, include: { files: { where: { clientFileId } } } });
    if (version.status !== 'UPLOADING') throw new AppError('UPLOAD_NOT_OPEN');
    const [file] = version.files;
    if (!file) return;
    await queueDeletions(tx, bucket, [file]);
    await tx.submissionFile.delete({ where: { id: file.id } });
  });
}
