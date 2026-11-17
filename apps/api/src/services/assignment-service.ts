import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Assignment, Prisma, PrismaClient, ReferenceFile } from '@prisma/client';
import { LIMITS, sniffFileType } from '@edugemini/shared';
import type {
  AssignmentDetail,
  AssignmentPage,
  AssignmentSummary,
  CreateAssignment,
  ListAssignmentsQuery,
  PublishedAssignment,
  PublishWarning,
  ReferenceFileLink,
  ReferenceFileView,
  ScoringFormat,
  UpdateAssignment,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, pageOf } from '../lib/cursor';
import { lockAssignment } from '../lib/lock';
import { countPdfPages } from '../lib/pdf-pages';
import { queueDeletions, readHead, SIGNED_URL_SECONDS, type StorageAdapter } from '../lib/storage';
import { authorize, can, type Action, type Actor } from '../policy/policy';

/** Assignments (API Spec ASG-01 to ASG-04, ASG-06). The owning instructor does everything; an approved student can read published ones. */

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_DAYS = 7; // a draft's due date until the instructor sets one (API Spec B.6)

const toSummary = (row: Assignment): AssignmentSummary => ({
  id: row.id,
  classId: row.classId,
  title: row.title,
  dueAt: row.dueAt.toISOString(),
  timezone: row.timezone,
  status: row.status,
  scoringFormat: row.scoringFormat,
  maxScore: row.maxScore.toNumber(),
  maxResubmissions: row.maxResubmissions,
  acceptLate: row.acceptLate,
  criteriaVersion: row.criteriaVersion,
});

/** Loads an assignment's reference files in their places, for `toDetail`. */
const withFiles = { referenceFiles: { orderBy: { ordinal: 'asc' } } } as const;
type AssignmentWithFiles = Prisma.AssignmentGetPayload<{ include: typeof withFiles }>;

const toReferenceFile = (file: ReferenceFile): ReferenceFileView => ({
  id: file.id,
  ordinal: file.ordinal,
  label: `Reference file ${file.ordinal}`,
  mimeType: file.mimeType,
  sizeBytes: Number(file.sizeBytes),
  visibleToStudents: file.visibleToStudents,
});

/** A student is shown only the reference files marked visible (API Spec A5). */
const toDetail = (row: AssignmentWithFiles, student = false): AssignmentDetail => ({
  ...toSummary(row),
  instructions: row.instructions,
  criteriaText: row.criteriaText,
  referenceFiles: row.referenceFiles.filter((file) => !student || file.visibleToStudents).map(toReferenceFile),
});

/** A student's status in the class. Anyone else has none, so no lookup is made for them. */
export async function enrollmentOf(db: PrismaClient, actor: Actor, classId: string) {
  if (actor.role !== 'STUDENT') return undefined;
  const row = await db.enrollment.findUnique({
    where: { classId_studentId: { classId, studentId: actor.id } },
    select: { status: true },
  });
  return row?.status;
}

/**
 * The class, if the action is the caller's to do in it: the owning instructor, or for viewing an approved student (a
 * pending one is told so). Anyone else's class looks the same as a missing one (API Spec A3).
 */
async function classFor(db: PrismaClient, actor: Actor, classId: string, action: Action) {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, action, { classInstructorId: row.instructorId, enrollment: await enrollmentOf(db, actor, classId) });
  return row;
}

/** The assignment with its class's owner and archive state, if the action is the caller's to do in that class (as `classFor`). */
async function assignmentFor(db: PrismaClient, actor: Actor, assignmentId: string, action: Action) {
  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { instructorId: true, archivedAt: true } }, ...withFiles },
  });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, action, { classInstructorId: row.class.instructorId, enrollment: await enrollmentOf(db, actor, row.classId) });
  return row;
}

/** Percentage and letter formats are always out of 100, whatever was asked (API Spec A5). */
const maxScoreFor = (format: ScoringFormat, asked: number | undefined) => (format === 'POINTS' ? asked : 100);

/** Create a draft. Only the title is needed; everything else has a default (API Spec ASG-02). */
export async function createAssignment(
  db: PrismaClient,
  actor: Actor,
  classId: string,
  input: CreateAssignment,
): Promise<AssignmentDetail> {
  const cls = await classFor(db, actor, classId, 'assignment.write');
  if (cls.archivedAt) throw new AppError('CLASS_ARCHIVED'); // read-only (FR-CLS-06)

  const scoringFormat = input.scoringFormat ?? 'POINTS';
  const row = await db.assignment.create({
    data: {
      classId,
      title: input.title,
      instructions: input.instructions || null,
      criteriaText: input.criteriaText ?? '',
      dueAt: input.dueAt ? new Date(input.dueAt) : new Date(Date.now() + PLACEHOLDER_DAYS * DAY_MS),
      timezone: input.timezone ?? 'UTC',
      scoringFormat,
      maxScore: maxScoreFor(scoringFormat, input.maxScore) ?? 100,
      maxResubmissions: input.maxResubmissions === undefined ? 3 : input.maxResubmissions, // null is Unlimited (FR-ASG-10)
      acceptLate: input.acceptLate ?? true,
    },
    include: withFiles,
  });
  return toDetail(row);
}

/**
 * One assignment (API Spec ASG-03). A student sees published ones only: a draft or an archived assignment looks the same as
 * a missing one. The class is checked first, so a pending student is told they are pending and nothing about the assignment.
 */
export async function getAssignment(db: PrismaClient, actor: Actor, assignmentId: string): Promise<AssignmentDetail> {
  const row = await assignmentFor(db, actor, assignmentId, 'assignment.view');
  if (actor.role === 'STUDENT' && row.status !== 'PUBLISHED') throw new AppError('NOT_FOUND');
  return toDetail(row, actor.role === 'STUDENT');
}

/**
 * A class's assignments, nearest due date first (API Spec ASG-01). A student is always limited to published ones, so a
 * status filter that leaves them out gives an empty page.
 */
export async function listAssignments(
  db: PrismaClient,
  actor: Actor,
  classId: string,
  query: ListAssignmentsQuery,
): Promise<AssignmentPage> {
  await classFor(db, actor, classId, 'assignment.view');
  const student = actor.role === 'STUDENT';
  if (student && query.status && query.status !== 'PUBLISHED') return { items: [], nextCursor: null };

  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const status = student ? 'PUBLISHED' : query.status;
  const where: Prisma.AssignmentWhereInput = {
    classId,
    ...(status && { status }),
    ...(after && { OR: [{ dueAt: { gt: after.at } }, { dueAt: after.at, id: { gt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const rows = await db.assignment.findMany({ where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: query.limit + 1 });
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.dueAt, id: row.id }));
  return { items: page.map(toSummary), nextCursor };
}

/**
 * Edit an assignment (API Spec ASG-04). A draft takes every field. A published one takes every field but the criteria:
 * changing those needs the criteria impact check, which comes with the edit-after-publish ticket (ASG-04), so for now it
 * answers CONFIRMATION_REQUIRED. A due date change recomputes nothing, because Late is derived from the dates. The scoring
 * format cannot change once a submission exists (PRD A13). An archived assignment answers CONFLICT.
 */
export async function updateAssignment(
  db: PrismaClient,
  actor: Actor,
  assignmentId: string,
  input: UpdateAssignment,
): Promise<AssignmentDetail> {
  const row = await assignmentFor(db, actor, assignmentId, 'assignment.write');
  if (row.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (row.status === 'ARCHIVED') throw new AppError('CONFLICT');

  const criteriaChanged = input.criteriaText !== undefined && input.criteriaText !== row.criteriaText;
  if (criteriaChanged && row.status !== 'DRAFT') throw new AppError('CONFIRMATION_REQUIRED');
  const formatChanged = input.scoringFormat !== undefined && input.scoringFormat !== row.scoringFormat;

  const scoringFormat = input.scoringFormat ?? row.scoringFormat;
  // The rules are part of the update, so a change that lands first (a publish before a criteria edit, a first submission
  // before a format change) makes this one change nothing instead of breaking them.
  const { count } = await db.assignment.updateMany({
    where: {
      id: assignmentId,
      status: criteriaChanged ? 'DRAFT' : { not: 'ARCHIVED' },
      ...(formatChanged && { submissions: { none: { state: { not: null } } } }), // a row with no state is an upload still open, not a submission
    },
    data: {
      updatedAt: new Date(), // always one field to write: with none, the update does not run and would count as a miss
      title: input.title,
      instructions: input.instructions === undefined ? undefined : input.instructions || null,
      criteriaText: input.criteriaText,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      timezone: input.timezone,
      scoringFormat: input.scoringFormat,
      maxScore: maxScoreFor(scoringFormat, input.maxScore),
      maxResubmissions: input.maxResubmissions, // null is Unlimited; undefined leaves it alone
      acceptLate: input.acceptLate,
    },
  });
  if (count === 0) {
    const locked = formatChanged && (await db.submission.count({ where: { assignmentId, state: { not: null } } })) > 0;
    throw new AppError(locked ? 'FORMAT_LOCKED' : 'CONFLICT');
  }
  return toDetail(await db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: withFiles }));
}

/**
 * Publish a draft (API Spec ASG-06). Publishing a published assignment changes nothing, so it answers again with the
 * warnings. The warnings never block: a past due date makes every submission Late, and without a connected Gemini key
 * submissions wait for manual review (App Flow F16, PRD A8).
 */
export async function publishAssignment(db: PrismaClient, actor: Actor, assignmentId: string): Promise<PublishedAssignment> {
  const row = await assignmentFor(db, actor, assignmentId, 'assignment.write');
  if (row.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (row.status === 'ARCHIVED') throw new AppError('CONFLICT');

  if (row.status === 'DRAFT') {
    if (!row.criteriaText.trim()) {
      throw new AppError('VALIDATION', { fields: { criteriaText: 'Add grading criteria before publishing' } });
    }
    await db.assignment.updateMany({ where: { id: assignmentId, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  }

  const published = await db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: withFiles });
  const warnings: PublishWarning[] = [];
  if (published.dueAt.getTime() < Date.now()) warnings.push('DUE_IN_PAST');
  if ((await db.instructorKey.count({ where: { instructorId: actor.id, status: 'CONNECTED' } })) === 0) warnings.push('NO_VALID_KEY');
  return { ...toDetail(published), warnings };
}

// ---------- Reference files (API Spec REF-01 to REF-04) ----------
// Part of the criteria, so on a published assignment adding or removing one needs the criteria impact check (API Spec A6).
// That check is not built yet, so for now those answer CONFIRMATION_REQUIRED, as a criteria edit does. A draft needs no token.

const FILE_PLACES = Array.from({ length: LIMITS.maxReferenceFiles }, (_, index) => index + 1);

/**
 * Add a reference file to a draft (API Spec REF-01). `tempPath` is the upload as the multipart parser left it on disk, with
 * the size cap already applied. The type comes from the first bytes, never the name; a PDF is opened to be sure it is readable.
 * The object is stored first, then the row takes the next free place (1 to 3) on the locked assignment row, so two adds at the
 * same moment never share a place. A row that cannot be written removes the object again.
 */
export async function addReferenceFile(
  db: PrismaClient,
  storage: StorageAdapter,
  bucket: string,
  actor: Actor,
  assignmentId: string,
  tempPath: string,
): Promise<ReferenceFileView> {
  const row = await assignmentFor(db, actor, assignmentId, 'assignment.write');
  if (row.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (row.status === 'ARCHIVED') throw new AppError('CONFLICT');
  if (row.status !== 'DRAFT') throw new AppError('CONFIRMATION_REQUIRED');
  if (row.referenceFiles.length >= LIMITS.maxReferenceFiles) throw new AppError('FILE_LIMIT', { details: { limit: 'reference-count' } });

  const kind = sniffFileType(await readHead(tempPath));
  if (!kind) throw new AppError('FILE_TYPE');
  if (kind.mimeType === 'application/pdf') await countPdfPages(tempPath);

  // Built from IDs and the sniffed type, never from the file's name (code-standards §9).
  const path = `reference/${row.classId}/${assignmentId}/${randomUUID()}.${kind.extension}`;
  const stored = await storage.put(bucket, path, createReadStream(tempPath), kind.mimeType, LIMITS.maxFileBytes);

  try {
    return await db.$transaction(async (tx) => {
      await lockAssignment(tx, assignmentId);
      const current = await tx.assignment.findUnique({ where: { id: assignmentId }, include: { referenceFiles: { select: { ordinal: true } } } });
      if (!current) throw new AppError('NOT_FOUND');
      if (current.status !== 'DRAFT') throw new AppError('CONFIRMATION_REQUIRED'); // published while the file was arriving
      const used = new Set(current.referenceFiles.map((file) => file.ordinal));
      const ordinal = FILE_PLACES.find((place) => !used.has(place));
      if (!ordinal) throw new AppError('FILE_LIMIT', { details: { limit: 'reference-count' } });
      const created = await tx.referenceFile.create({
        data: { assignmentId, ordinal, storagePath: path, mimeType: kind.mimeType, sizeBytes: stored.size, sha256: stored.sha256 },
      });
      return toReferenceFile(created);
    });
  } catch (error) {
    await storage.remove(bucket, [path]).catch(() => undefined); // no object without a row
    throw error;
  }
}

/** The reference file, if it is in a class the caller owns. Someone else's file looks the same as a missing one (API Spec A3). */
async function ownReferenceFile(db: PrismaClient, actor: Actor, fileId: string) {
  const file = await db.referenceFile.findUnique({
    where: { id: fileId },
    include: { assignment: { include: { class: { select: { instructorId: true, archivedAt: true } } } } },
  });
  if (!file) throw new AppError('NOT_FOUND');
  authorize(actor, 'assignment.write', { classInstructorId: file.assignment.class.instructorId });
  return file;
}

/** Show a reference file to students or hide it (API Spec REF-02). Not a criteria change, so no token and no re-grade. */
export async function setReferenceVisibility(db: PrismaClient, actor: Actor, fileId: string, visibleToStudents: boolean): Promise<ReferenceFileView> {
  const file = await ownReferenceFile(db, actor, fileId);
  if (file.assignment.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (file.assignment.status === 'ARCHIVED') throw new AppError('CONFLICT');
  return toReferenceFile(await db.referenceFile.update({ where: { id: fileId }, data: { visibleToStudents } }));
}

/**
 * Remove a reference file from a draft (API Spec REF-03). The row goes and its object is queued for deletion; the other
 * files keep their places. It runs on the locked assignment row, so it cannot cross an add or a publish.
 */
export async function removeReferenceFile(db: PrismaClient, bucket: string, actor: Actor, fileId: string): Promise<void> {
  const { assignmentId, assignment } = await ownReferenceFile(db, actor, fileId);
  if (assignment.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (assignment.status === 'ARCHIVED') throw new AppError('CONFLICT');
  if (assignment.status !== 'DRAFT') throw new AppError('CONFIRMATION_REQUIRED');

  await db.$transaction(async (tx) => {
    await lockAssignment(tx, assignmentId);
    const file = await tx.referenceFile.findUnique({ where: { id: fileId }, include: { assignment: { select: { status: true } } } });
    if (!file) throw new AppError('NOT_FOUND'); // removed by another request while this one waited
    if (file.assignment.status !== 'DRAFT') throw new AppError('CONFIRMATION_REQUIRED'); // published meanwhile
    await queueDeletions(tx, bucket, [file]);
    await tx.referenceFile.delete({ where: { id: fileId } });
  });
}

/**
 * A link to a reference file, good for five minutes (API Spec REF-04, TRD §9.3). The owning instructor always gets one; an
 * approved student only for a file marked visible on a published assignment. Everyone else, a hidden file included, finds nothing.
 */
export async function referenceFileUrl(
  db: PrismaClient,
  storage: StorageAdapter,
  bucket: string,
  actor: Actor,
  fileId: string,
): Promise<ReferenceFileLink> {
  const file = await db.referenceFile.findUnique({
    where: { id: fileId },
    include: { assignment: { include: { class: { select: { instructorId: true } } } } },
  });
  if (!file) throw new AppError('NOT_FOUND');

  const { assignment } = file;
  const allowed = can(actor, 'assignment.view', {
    classInstructorId: assignment.class.instructorId,
    enrollment: await enrollmentOf(db, actor, assignment.classId),
  });
  const studentMayOpen = file.visibleToStudents && assignment.status === 'PUBLISHED';
  if (!allowed || (actor.role === 'STUDENT' && !studentMayOpen)) throw new AppError('NOT_FOUND');

  const url = await storage.signedUrl(bucket, file.storagePath, SIGNED_URL_SECONDS);
  return { url, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() };
}
