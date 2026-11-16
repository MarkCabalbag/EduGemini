import type { Assignment, Prisma, PrismaClient } from '@prisma/client';
import type {
  AssignmentDetail,
  AssignmentPage,
  AssignmentSummary,
  CreateAssignment,
  ListAssignmentsQuery,
  PublishedAssignment,
  PublishWarning,
  ScoringFormat,
  UpdateAssignment,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { authorize, type Action, type Actor } from '../policy/policy';

/** Assignments for the owning instructor (API Spec ASG-01 to ASG-04, ASG-06). Students see them with the student tickets (ASG-03). */

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

const toDetail = (row: Assignment): AssignmentDetail => ({
  ...toSummary(row),
  instructions: row.instructions,
  criteriaText: row.criteriaText,
});

/** The class, if the action is the caller's to do in it. Someone else's class looks the same as a missing one (API Spec A3). */
async function ownClass(db: PrismaClient, actor: Actor, classId: string, action: Action) {
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, action, { classInstructorId: row.instructorId });
  return row;
}

/** The assignment with its class's owner and archive state, if the class is the caller's. */
async function ownAssignment(db: PrismaClient, actor: Actor, assignmentId: string, action: Action) {
  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { instructorId: true, archivedAt: true } } },
  });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, action, { classInstructorId: row.class.instructorId });
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
  const cls = await ownClass(db, actor, classId, 'assignment.write');
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
  });
  return toDetail(row);
}

export async function getAssignment(db: PrismaClient, actor: Actor, assignmentId: string): Promise<AssignmentDetail> {
  return toDetail(await ownAssignment(db, actor, assignmentId, 'assignment.view'));
}

/** A class's assignments, nearest due date first (API Spec ASG-01). */
export async function listAssignments(
  db: PrismaClient,
  actor: Actor,
  classId: string,
  query: ListAssignmentsQuery,
): Promise<AssignmentPage> {
  await ownClass(db, actor, classId, 'assignment.view');

  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.AssignmentWhereInput = {
    classId,
    ...(query.status && { status: query.status }),
    ...(after && { OR: [{ dueAt: { gt: after.at } }, { dueAt: after.at, id: { gt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const rows = await db.assignment.findMany({ where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: query.limit + 1 });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.dueAt, id: last.id }) : null,
  };
}

/**
 * Edit a draft (API Spec ASG-04). A published or archived assignment answers CONFLICT for now: changing one needs the
 * criteria impact check, which comes with the edit-after-publish ticket (ASG-04).
 */
export async function updateAssignment(
  db: PrismaClient,
  actor: Actor,
  assignmentId: string,
  input: UpdateAssignment,
): Promise<AssignmentDetail> {
  const row = await ownAssignment(db, actor, assignmentId, 'assignment.write');
  if (row.class.archivedAt) throw new AppError('CLASS_ARCHIVED');

  const scoringFormat = input.scoringFormat ?? row.scoringFormat;
  // The state is part of the update, so a publish that lands first makes this one change nothing instead of editing a published assignment.
  const { count } = await db.assignment.updateMany({
    where: { id: assignmentId, status: 'DRAFT' },
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
  if (count === 0) throw new AppError('CONFLICT');
  return toDetail(await db.assignment.findUniqueOrThrow({ where: { id: assignmentId } }));
}

/**
 * Publish a draft (API Spec ASG-06). Publishing a published assignment changes nothing, so it answers again with the
 * warnings. The warnings never block: a past due date makes every submission Late, and without a connected Gemini key
 * submissions wait for manual review (App Flow F16, PRD A8).
 */
export async function publishAssignment(db: PrismaClient, actor: Actor, assignmentId: string): Promise<PublishedAssignment> {
  const row = await ownAssignment(db, actor, assignmentId, 'assignment.write');
  if (row.class.archivedAt) throw new AppError('CLASS_ARCHIVED');
  if (row.status === 'ARCHIVED') throw new AppError('CONFLICT');

  if (row.status === 'DRAFT') {
    if (!row.criteriaText.trim()) {
      throw new AppError('VALIDATION', { fields: { criteriaText: 'Add grading criteria before publishing' } });
    }
    await db.assignment.updateMany({ where: { id: assignmentId, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  }

  const published = await db.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const warnings: PublishWarning[] = [];
  if (published.dueAt.getTime() < Date.now()) warnings.push('DUE_IN_PAST');
  if ((await db.instructorKey.count({ where: { instructorId: actor.id, status: 'CONNECTED' } })) === 0) warnings.push('NO_VALID_KEY');
  return { ...toDetail(published), warnings };
}
