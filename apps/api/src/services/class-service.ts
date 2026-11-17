import { randomInt } from 'node:crypto';
import type { Class, Prisma, PrismaClient } from '@prisma/client';
import type {
  ClassDeletionImpact,
  ClassPage,
  ClassSummary,
  CreateClass,
  EnrollmentCounts,
  EnrollmentStatus,
  ListClassesQuery,
  UpdateClass,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, pageOf } from '../lib/cursor';
import { lockClass } from '../lib/lock';
import { isUniqueViolation } from '../lib/prisma-errors';
import { authorize, decide, type Actor } from '../policy/policy';
import { notify } from './notification-service';
import { enrollmentCounts } from './people-service';
import { queueDeletions } from './submission-service';

// 32 characters: letters without I and O, digits 2 to 9 (Backend Schema §4.7). No look-alikes (PRD FR-CLS-02).
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;
const CODE_RETRIES = 5; // after the first try (API Spec CLS-02)

export function newJoinCode(): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET.charAt(randomInt(JOIN_CODE_ALPHABET.length));
  return code;
}

/** The page students open to join (TRD §15.1). Plain joining, so a path in APP_URL is kept. */
export const joinLinkFor = (appUrl: string, code: string) => `${appUrl.replace(/\/+$/, '')}/join/${code}`;

/** What a class shows to everyone who may see it. */
const classDetails = (row: Class) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  section: row.section,
  subject: row.subject,
  room: row.room,
  status: row.archivedAt ? ('ARCHIVED' as const) : ('ACTIVE' as const),
});

/** First name and last initial, like "Maria R.": all a student learns about the instructor (UX Brief D-U4). */
export const instructorName = ({ firstName, lastName }: { firstName: string; lastName: string }) => `${firstName} ${[...lastName][0]}.`;

export const withInstructor = { instructor: { select: { firstName: true, lastName: true } } } as const;
type ClassWithInstructor = Prisma.ClassGetPayload<{ include: typeof withInstructor }>;

/** The class as a student in it sees it: no code, link or counts. */
function toStudentClassSummary(row: ClassWithInstructor, status: EnrollmentStatus): ClassSummary {
  return { ...classDetails(row), instructorName: instructorName(row.instructor), enrollment: { status } };
}

/** The class as its owning instructor sees it. */
function toClassSummary(row: Class, appUrl: string, counts?: EnrollmentCounts): ClassSummary {
  return {
    ...classDetails(row),
    joinCode: row.joinCode,
    joinLink: joinLinkFor(appUrl, row.joinCode),
    joinCodeActive: row.joinCodeActive,
    requireApproval: row.requireApproval,
    ...(counts && { counts }),
  };
}

/**
 * Save with a fresh join code, picking another when one is taken (API Spec CLS-02, CLS-08). The unique index on join_code
 * is the source of truth, so two classes racing for one code cannot both win. A `save` that runs in a transaction must
 * start it inside, so each try has its own.
 */
async function saveWithFreshCode<T>(save: (joinCode: string) => Promise<T>): Promise<T> {
  for (let retry = 0; retry <= CODE_RETRIES; retry++) {
    try {
      return await save(newJoinCode());
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // the code is taken: try another
    }
  }
  throw new AppError('INTERNAL', { message: `No free join code after ${CODE_RETRIES + 1} tries` });
}

/** The route also checks the role, earlier, so a student cannot tell the route exists (API Spec A3). */
export async function createClass(db: PrismaClient, actor: Actor, input: CreateClass, appUrl: string): Promise<ClassSummary> {
  authorize(actor, 'class.create');

  const row = await saveWithFreshCode((joinCode) =>
    db.class.create({
      data: {
        instructorId: actor.id,
        name: input.name,
        description: input.description || null,
        section: input.section || null,
        subject: input.subject || null,
        room: input.room || null,
        joinCode,
        attestedAt: new Date(),
      },
    }),
  );
  return toClassSummary(row, appUrl);
}

/** The caller's own classes, newest first. Archived classes only when asked for (API Spec CLS-01). */
export async function listClasses(
  db: PrismaClient,
  actor: Actor,
  query: ListClassesQuery,
  appUrl: string,
): Promise<ClassPage> {
  authorize(actor, 'class.list');

  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.ClassWhereInput = {
    instructorId: actor.id,
    archivedAt: query.status === 'ARCHIVED' ? { not: null } : null,
    ...(after && { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const rows = await db.class.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.createdAt, id: row.id }));
  return { items: page.map((row) => toClassSummary(row, appUrl)), nextCursor };
}

export async function getClass(db: PrismaClient, actor: Actor, classId: string, appUrl: string): Promise<ClassSummary> {
  const row = await db.class.findUnique({ where: { id: classId }, include: withInstructor });
  if (!row) throw new AppError('NOT_FOUND');

  if (actor.role === 'STUDENT') {
    const mine = await db.enrollment.findUnique({ where: { classId_studentId: { classId, studentId: actor.id } } });
    const decision = decide(actor, 'class.view', { classInstructorId: row.instructorId, enrollment: mine?.status });
    // A pending student is told the class name and nothing else (API Spec CLS-03). Declined, removed and strangers find nothing.
    if (decision === 'pending') throw new AppError('ENROLLMENT_PENDING', { details: { className: row.name } });
    if (decision === 'not_found' || !mine) throw new AppError('NOT_FOUND');
    return toStudentClassSummary(row, mine.status);
  }

  authorize(actor, 'class.view', { classInstructorId: row.instructorId }); // someone else's class looks the same as a missing one
  return toClassSummary(row, appUrl, await enrollmentCounts(db, row.id));
}

/**
 * Change a class's name, description, section, subject or room (API Spec CLS-04). A field left out stays as it is and a
 * blank optional one is cleared. The code and the students are not touched. An archived class is read-only (FR-CLS-06).
 */
export async function updateClass(
  db: PrismaClient,
  actor: Actor,
  classId: string,
  input: UpdateClass,
  appUrl: string,
): Promise<ClassSummary> {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.edit', { classInstructorId: row.instructorId }); // someone else's class looks the same as a missing one
  if (row.archivedAt) throw new AppError('CLASS_ARCHIVED');

  const blankIsNull = (value?: string) => (value === undefined ? undefined : value || null); // undefined: leave as is
  const updated = await db.class.update({
    where: { id: classId },
    data: {
      name: input.name,
      description: blankIsNull(input.description),
      section: blankIsNull(input.section),
      subject: blankIsNull(input.subject),
      room: blankIsNull(input.room),
    },
  });
  return toClassSummary(updated, appUrl);
}

/** Stops unless the class is the caller's to archive. Someone else's class looks the same as a missing one (API Spec A3). */
async function authorizeArchive(db: PrismaClient, actor: Actor, classId: string) {
  const row = await db.class.findUnique({ where: { id: classId }, select: { instructorId: true } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.archive', { classInstructorId: row.instructorId });
}

/**
 * Archive a class: read-only for everyone (API Spec CLS-05). Archiving an archived class changes nothing, so the date
 * stays where it was and the retention clock is not extended.
 */
export async function archiveClass(db: PrismaClient, actor: Actor, classId: string, appUrl: string): Promise<ClassSummary> {
  await authorizeArchive(db, actor, classId);
  await db.class.updateMany({ where: { id: classId, archivedAt: null }, data: { archivedAt: new Date() } });
  return toClassSummary(await db.class.findUniqueOrThrow({ where: { id: classId } }), appUrl);
}

/** Restore an archived class (API Spec CLS-06). The notice date goes with the archive date: the database allows no notice without one. */
export async function restoreClass(db: PrismaClient, actor: Actor, classId: string, appUrl: string): Promise<ClassSummary> {
  await authorizeArchive(db, actor, classId);
  await db.class.updateMany({ where: { id: classId, archivedAt: { not: null } }, data: { archivedAt: null, retentionNoticeAt: null } });
  return toClassSummary(await db.class.findUniqueOrThrow({ where: { id: classId } }), appUrl);
}

/** The class, if its code is the caller's to change. Someone else's class looks the same as a missing one (API Spec A3). */
async function ownClassForCode(db: PrismaClient, actor: Actor, classId: string) {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.regenerateCode', { classInstructorId: row.instructorId });
  return row;
}

/**
 * Give the class a new code and switch it on, which is also how a disabled code comes back (API Spec CLS-08). The old
 * code stops working at once. The students are not touched. An archived class is read-only (FR-CLS-06).
 */
export async function regenerateCode(db: PrismaClient, actor: Actor, classId: string, appUrl: string): Promise<ClassSummary> {
  await ownClassForCode(db, actor, classId);

  const row = await saveWithFreshCode((joinCode) =>
    db.$transaction(async (tx) => {
      await lockClass(tx, classId);
      // Read again under the lock: the class may have been archived or deleted while this request waited.
      const current = await tx.class.findUnique({ where: { id: classId } });
      if (!current) throw new AppError('NOT_FOUND');
      if (current.archivedAt) throw new AppError('CLASS_ARCHIVED');
      return tx.class.update({ where: { id: classId }, data: { joinCode, joinCodeActive: true } });
    }),
  );
  return toClassSummary(row, appUrl);
}

/** Switch the code off, so it reads as invalid for everyone. Doing it again changes nothing (API Spec CLS-09). */
export async function disableCode(db: PrismaClient, actor: Actor, classId: string, appUrl: string): Promise<ClassSummary> {
  const row = await ownClassForCode(db, actor, classId);
  if (row.archivedAt) throw new AppError('CLASS_ARCHIVED'); // read-only (FR-CLS-06)

  return toClassSummary(await db.class.update({ where: { id: classId }, data: { joinCodeActive: false } }), appUrl);
}

/** The class, if the caller may delete it. Someone else's class looks the same as a missing one (API Spec A3). */
async function ownClassToDelete(db: PrismaClient, actor: Actor, classId: string) {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.delete', { classInstructorId: row.instructorId });
  return row;
}

/** What deleting the class would remove (API Spec CLS-11). Counted again when the delete is confirmed, so this is only a preview. */
export async function deletionImpact(db: PrismaClient, actor: Actor, classId: string): Promise<ClassDeletionImpact> {
  await ownClassToDelete(db, actor, classId);

  const [enrollments, assignments, submissions, submissionFiles, referenceFiles, announcementFiles] = await Promise.all([
    db.enrollment.groupBy({ by: ['status'], where: { classId }, _count: { _all: true } }),
    db.assignment.count({ where: { classId } }),
    db.submission.count({ where: { assignment: { classId } } }),
    db.submissionFile.count({ where: { version: { submission: { assignment: { classId } } } } }),
    db.referenceFile.count({ where: { assignment: { classId } } }),
    db.announcementFile.count({ where: { announcement: { classId } } }),
  ]);
  const students = (status?: EnrollmentStatus) =>
    enrollments.filter((group) => !status || group.status === status).reduce((sum, group) => sum + group._count._all, 0);

  return {
    students: students(),
    approvedStudents: students('ACTIVE'),
    pendingStudents: students('PENDING'),
    assignments,
    submissions,
    files: submissionFiles + referenceFiles + announcementFiles,
  };
}

/**
 * Delete the class and everything in it, in one transaction on the locked class row (API Spec CLS-07, Backend Schema §10.2).
 * The stored objects go to the storage outbox first; the `storage.cleanup` job deletes them after the commit. The approved
 * students are told. The confirmation is the class name, compared against the name read under the lock.
 */
export async function deleteClass(db: PrismaClient, bucket: string, actor: Actor, classId: string, confirmation: string): Promise<void> {
  await ownClassToDelete(db, actor, classId);

  await db.$transaction(async (tx) => {
    await lockClass(tx, classId);
    // Read again under the lock: a request that waited behind another delete finds the class gone.
    const row = await tx.class.findUnique({ where: { id: classId } });
    if (!row) throw new AppError('NOT_FOUND');
    if (confirmation.trim() !== row.name) throw new AppError('CONFIRMATION_MISMATCH');

    const [submissionFiles, referenceFiles, announcementFiles, approved] = await Promise.all([
      tx.submissionFile.findMany({ where: { version: { submission: { assignment: { classId } } } }, select: { storagePath: true } }),
      tx.referenceFile.findMany({ where: { assignment: { classId } }, select: { storagePath: true } }),
      tx.announcementFile.findMany({ where: { announcement: { classId } }, select: { storagePath: true } }),
      tx.enrollment.findMany({ where: { classId, status: 'ACTIVE' }, select: { studentId: true } }),
    ]);
    await queueDeletions(tx, bucket, [...submissionFiles, ...referenceFiles, ...announcementFiles]);
    await tx.class.delete({ where: { id: classId } }); // the rest goes with it (foreign-key cascades)
    // The class is gone, so the notification opens the student's class list. Titles and links are final with NTF-05.
    await notify(tx, 'CLASS_DELETED', approved.map((enrollment) => enrollment.studentId), { link: '/classes', className: row.name });
  });
}

