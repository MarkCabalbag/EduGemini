import { randomInt } from 'node:crypto';
import { Prisma, type Class, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ClassPage, ClassSummary, CreateClass, EnrollmentStatus, JoinPreview, JoinResult, ListClassesQuery } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { authorize, type Actor } from '../policy/policy';

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

/** The class as its owning instructor sees it. Students get their own view with the join tickets. */
function toClassSummary(row: Class, appUrl: string): ClassSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    section: row.section,
    subject: row.subject,
    room: row.room,
    status: row.archivedAt ? 'ARCHIVED' : 'ACTIVE',
    joinCode: row.joinCode,
    joinLink: joinLinkFor(appUrl, row.joinCode),
    joinCodeActive: row.joinCodeActive,
    requireApproval: row.requireApproval,
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

/** The cursor is the last row of the page, so the next page is the rows older than it. It cannot go stale. */
const encodeCursor = (row: Pick<Class, 'createdAt' | 'id'>) =>
  Buffer.from(`${row.createdAt.getTime()}:${row.id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const uuid = z.uuid().safeParse(id);
  const after = ms && /^\d{1,13}$/.test(ms) && uuid.success ? { createdAt: new Date(Number(ms)), id: uuid.data } : undefined;
  // Only a cursor we made ourselves is accepted: extra segments or stray characters change the encoded form.
  if (!after || encodeCursor(after) !== cursor) {
    throw new AppError('VALIDATION', { fields: { 'query.cursor': 'That page link is not valid.' } });
  }
  return after;
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
    ...(after && { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }),
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
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
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
  const row = await db.class.findUnique({ where: { id: classId } });
  if (!row) throw new AppError('NOT_FOUND');
  authorize(actor, 'class.view', { classInstructorId: row.instructorId }); // someone else's class looks the same as a missing one
  return toClassSummary(row, appUrl);
}
