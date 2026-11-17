import type { Prisma, PrismaClient } from '@prisma/client';
import type { EnrolledPage, EnrolledQuery, EnrollmentStatus, JoinPreview, JoinResult } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, pageOf } from '../lib/cursor';
import { isUniqueViolation } from '../lib/prisma-errors';
import { authorize, type Actor } from '../policy/policy';
import { instructorName, JOIN_CODE_LENGTH, withInstructor } from './class-service';

/** A student joining a class by its code, and the student's list of classes (API Spec JOIN-01 to JOIN-03). */

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
    const winner = isUniqueViolation(error) ? await current() : null;
    if (!winner) throw error;
    return answer(winner.status, false);
  }
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
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.joinedAt, id: row.id }));
  return {
    items: page.map((row) => ({
      classId: row.classId,
      className: row.class.name,
      status: row.status,
      instructorName: instructorName(row.class.instructor),
      archived: row.class.archivedAt !== null,
      joinedAt: row.joinedAt.toISOString(),
    })),
    nextCursor,
  };
}
