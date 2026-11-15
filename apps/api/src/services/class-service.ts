import { randomInt } from 'node:crypto';
import { Prisma, type Class, type PrismaClient } from '@prisma/client';
import type {
  ClassPage,
  ClassSummary,
  CreateClass,
  EnrolledPage,
  EnrolledQuery,
  EnrollmentCounts,
  EnrollmentStatus,
  JoinPreview,
  JoinResult,
  ListClassesQuery,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { authorize, decide, type Actor } from '../policy/policy';
import { enrollmentCounts } from './people-service';

// 32 characters: letters without I and O, digits 2 to 9 (Backend Schema §4.7). No look-alikes (PRD FR-CLS-02).
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;
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
const instructorName = ({ firstName, lastName }: { firstName: string; lastName: string }) => `${firstName} ${[...lastName][0]}.`;

const withInstructor = { instructor: { select: { firstName: true, lastName: true } } } as const;
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

/** The route also checks the role, earlier, so a student cannot tell the route exists (API Spec A3). */
export async function createClass(db: PrismaClient, actor: Actor, input: CreateClass, appUrl: string): Promise<ClassSummary> {
  authorize(actor, 'class.create');

  for (let retry = 0; retry <= CODE_RETRIES; retry++) {
    try {
      const row = await db.class.create({
        data: {
          instructorId: actor.id,
          name: input.name,
          description: input.description || null,
          section: input.section || null,
          subject: input.subject || null,
          room: input.room || null,
          joinCode: newJoinCode(),
          attestedAt: new Date(),
        },
      });
      return toClassSummary(row, appUrl);
    } catch (error) {
      // The unique index on join_code is the source of truth, so two classes racing for one code cannot both win.
      const codeTaken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!codeTaken) throw error;
    }
  }
  throw new AppError('INTERNAL', { message: `No free join code after ${CODE_RETRIES + 1} tries` });
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
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toClassSummary(row, appUrl)),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

// A code that is unknown, switched off, replaced or on an archived class finds nothing, so all four look the same and
// no class information is given.
const joinable = (code: string) => ({ joinCode: code, joinCodeActive: true, archivedAt: null });

/** What a join link shows (API Spec JOIN-02). Anyone may ask, signed in or not. The caller normalizes the code (trim, capitals). */
export async function previewJoin(db: PrismaClient, code: string): Promise<JoinPreview> {
  // A code of the wrong length cannot match, so it is not looked up: the path can be any length.
  const row =
    code.length === JOIN_CODE_LENGTH
      ? await db.class.findFirst({ where: joinable(code), include: { instructor: { select: { firstName: true } } } })
      : null;
  if (!row) throw new AppError('INVALID_JOIN_CODE');
  return { className: row.name, instructorFirstName: row.instructor.firstName, requireApproval: row.requireApproval };
}

/**
 * Join by code (API Spec JOIN-01). `created` is true for a new enrollment (201) and false when the student was already in
 * (200), so joining twice does nothing new. A declined student stays declined; a removed student is refused.
 */
export async function joinClass(db: PrismaClient, actor: Actor, code: string): Promise<{ result: JoinResult; created: boolean }> {
  authorize(actor, 'class.join');

  const row = await db.class.findFirst({ where: joinable(code) });
  if (!row) throw new AppError('INVALID_JOIN_CODE');

  const current = () => db.enrollment.findUnique({ where: { classId_studentId: { classId: row.id, studentId: actor.id } } });
  const answer = (status: EnrollmentStatus, created: boolean) => {
    if (status === 'REMOVED') throw new AppError('JOIN_BLOCKED');
    return { result: { classId: row.id, className: row.name, status }, created };
  };

  const before = await current();
  if (before) return answer(before.status, false);

  try {
    const made = await db.enrollment.create({
      data: { classId: row.id, studentId: actor.id, status: row.requireApproval ? 'PENDING' : 'ACTIVE' },
    });
    return answer(made.status, true);
  } catch (error) {
    // Two joins at once: the unique (class, student) key lets one win, and the other reads the winner's row.
    const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    const winner = raced ? await current() : null;
    if (!winner) throw error;
    return answer(winner.status, false);
  }
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

/** The student's own classes, newest joined first, whatever the status except removed (API Spec JOIN-03). */
export async function listEnrollments(db: PrismaClient, actor: Actor, query: EnrolledQuery): Promise<EnrolledPage> {
  authorize(actor, 'class.listEnrolled');

  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.EnrollmentWhereInput = {
    studentId: actor.id,
    status: { not: 'REMOVED' },
    ...(after && { OR: [{ joinedAt: { lt: after.at } }, { joinedAt: after.at, id: { lt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const rows = await db.enrollment.findMany({
    where,
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    include: { class: { include: withInstructor } },
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      classId: row.classId,
      className: row.class.name,
      status: row.status,
      instructorName: instructorName(row.class.instructor),
      archived: row.class.archivedAt !== null,
      joinedAt: row.joinedAt.toISOString(),
    })),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.joinedAt, id: last.id }) : null,
  };
}
