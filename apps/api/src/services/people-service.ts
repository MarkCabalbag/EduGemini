import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ApproveAllResult,
  ClassSettings,
  ClassSettingsResult,
  Decision,
  EnrollmentCounts,
  EnrollmentStatus,
  EnrollmentView,
  PeoplePage,
  PeopleQuery,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, pageOf } from '../lib/cursor';
import { authorize, type Actor } from '../policy/policy';

/** Join approval and the people in a class (API Spec CLS-10, PPL-01 to PPL-03). All of it is for the owning instructor. */

/** The class, if it is the caller's. Someone else's class looks the same as a missing one (API Spec A3). */
async function ownClass(db: PrismaClient, actor: Actor, classId: string) {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.manageMembers', { classInstructorId: row.instructorId });
  return row;
}

/** How many students are in each state. */
export async function enrollmentCounts(db: PrismaClient, classId: string): Promise<EnrollmentCounts> {
  const groups = await db.enrollment.groupBy({ by: ['status'], where: { classId }, _count: { _all: true } });
  const count = (status: EnrollmentStatus) => groups.find((group) => group.status === status)?._count._all ?? 0;
  return { approved: count('ACTIVE'), pending: count('PENDING'), declined: count('DECLINED'), removed: count('REMOVED') };
}

/** Turn join approval on or off. Existing students are never changed, either way (PRD §8.3). */
export async function changeSettings(
  db: PrismaClient,
  actor: Actor,
  classId: string,
  input: ClassSettings,
): Promise<ClassSettingsResult> {
  const row = await ownClass(db, actor, classId);
  if (row.archivedAt) throw new AppError('CLASS_ARCHIVED');
  await db.class.update({ where: { id: classId }, data: { requireApproval: input.requireApproval } });
  const pendingCount = await db.enrollment.count({ where: { classId, status: 'PENDING' } });
  return { requireApproval: input.requireApproval, pendingCount };
}

const withStudent = { student: { select: { firstName: true, lastName: true, email: true } } } as const;
type EnrollmentWithStudent = Prisma.EnrollmentGetPayload<{ include: typeof withStudent }>;

function toView(row: EnrollmentWithStudent): EnrollmentView {
  return {
    id: row.id,
    student: { id: row.studentId, displayName: `${row.student.firstName} ${row.student.lastName}`, email: row.student.email },
    status: row.status,
    joinedAt: row.joinedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

/** Students in join order, oldest first, so the longest-waiting request is at the top. */
export async function listPeople(db: PrismaClient, actor: Actor, classId: string, query: PeopleQuery): Promise<PeoplePage> {
  await ownClass(db, actor, classId);

  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.EnrollmentWhereInput = {
    classId,
    ...(query.status && { status: query.status }),
    ...(after && { OR: [{ joinedAt: { gt: after.at } }, { joinedAt: after.at, id: { gt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const [counts, rows] = await Promise.all([
    enrollmentCounts(db, classId),
    db.enrollment.findMany({ where, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }], take: query.limit + 1, include: withStudent }),
  ]);
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.joinedAt, id: row.id }));
  return { counts, items: page.map(toView), nextCursor };
}

/** Each action, the states it may start from, and where it ends (API Spec PPL-02, Backend Schema §6.2). */
const TRANSITIONS = {
  APPROVE: { from: ['PENDING'], to: 'ACTIVE' },
  DECLINE: { from: ['PENDING'], to: 'DECLINED' },
  REVERSE: { from: ['DECLINED', 'REMOVED'], to: 'ACTIVE' }, // undo a decline, or reinstate a removed student
  REMOVE: { from: ['ACTIVE'], to: 'REMOVED' },
} as const satisfies Record<Decision['action'], { from: readonly EnrollmentStatus[]; to: EnrollmentStatus }>;

export async function decideEnrollment(
  db: PrismaClient,
  actor: Actor,
  enrollmentId: string,
  input: Decision,
): Promise<EnrollmentView> {
  const found = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { class: { select: { instructorId: true, archivedAt: true } } },
  });
  if (!found) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.manageMembers', { classInstructorId: found.class.instructorId });
  if (found.class.archivedAt) throw new AppError('CLASS_ARCHIVED'); // read-only (FR-CLS-06)

  // The change only happens if the row is still in a state this action starts from. Two decisions at once cannot both
  // win: the second finds the new state and reads it back as a conflict.
  const { from, to } = TRANSITIONS[input.action];
  const changed = await db.enrollment.updateMany({
    where: { id: enrollmentId, status: { in: [...from] } },
    data: { status: to, decidedAt: new Date(), decidedById: actor.id },
  });
  const row = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: withStudent });
  if (changed.count === 0) throw new AppError('CONFLICT', { details: { currentState: row.status } });
  return toView(row);
}

/** For after approval was turned off with students still waiting. Refused while approval is on, so new requests keep waiting. */
export async function approvePending(db: PrismaClient, actor: Actor, classId: string): Promise<ApproveAllResult> {
  const row = await ownClass(db, actor, classId);
  if (row.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (row.requireApproval) throw new AppError('CONFLICT');
  const { count } = await db.enrollment.updateMany({
    where: { classId, status: 'PENDING' },
    data: { status: 'ACTIVE', decidedAt: new Date(), decidedById: actor.id },
  });
  return { approvedCount: count };
}
