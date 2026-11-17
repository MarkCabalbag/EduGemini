import type { Notification as NotificationRow, Prisma, PrismaClient } from '@prisma/client';
import {
  NotificationPayloadSchema,
  type ListNotificationsQuery,
  type Notification,
  type NotificationPage,
  type NotificationPayload,
  type NotificationType,
  type ReadAllResult,
  type UnreadCount,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { decodeCursor, pageOf } from '../lib/cursor';
import type { Actor } from '../policy/policy';

/**
 * In-app notifications (API Spec NTF-01 to NTF-04, TRD §13.1). A user only ever sees and changes their own: every query is
 * limited to the caller's rows, so someone else's notification looks the same as a missing one (API Spec A3).
 */

/** The title of each type: the PRD §10 event name (UX Brief §11.6). */
const TITLES: Record<NotificationType, string> = {
  SUBMISSION_GRADED: 'Submission graded',
  GRADE_APPROVED: 'Instructor approved grade',
  SUBMISSION_AWAITING_REVIEW: 'New submission awaiting review',
  NEEDS_MANUAL_REVIEW_INSTRUCTOR: 'Submission moved to Needs manual review',
  NEEDS_MANUAL_REVIEW_STUDENT: 'Submitted, awaiting instructor review',
  KEY_NEEDS_ATTENTION: 'Gemini key needs attention',
  REGRADE_COMPLETE: 'Re-grade complete',
  SUBMISSION_REOPENED: 'Submission reopened by instructor',
  JOIN_REQUEST_RECEIVED: 'Join request received',
  JOIN_DECIDED: 'Join request approved or declined',
  ATTEMPTS_GRANTED: 'Extra resubmission attempts granted',
  LATE_ALLOWED: 'Late submission allowed by instructor',
  ASSIGNMENT_PUBLISHED: 'New assignment published',
  DUE_DATE_CHANGED: 'Assignment due date changed',
  CLASS_DELETED: 'Class deleted',
  INSTRUCTOR_ACCOUNT_DELETED: 'Instructor account deleted',
  ACCOUNT_STATUS_CHANGED: 'Account suspended or reinstated',
  RETENTION_NOTICE: 'Archived-class data scheduled for deletion',
  ANNOUNCEMENT_POSTED: 'New announcement',
};

function toView(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: TITLES[row.type],
    body: NotificationPayloadSchema.parse(row.payload).className ?? null,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The in-app half of `notify(type, recipients, payload)` (TRD §13.1): one row per recipient. Pass the transaction of the
 * event when there is one, so the notification exists only if the event does. `payload.link` is where the item opens; the
 * email half arrives with NTF-03.
 */
export async function notify(
  db: Prisma.TransactionClient,
  type: NotificationType,
  recipientIds: string[],
  { link, ...payload }: NotificationPayload & { link: string },
): Promise<void> {
  await db.notification.createMany({ data: recipientIds.map((userId) => ({ userId, type, link, payload })) });
}

/** The caller's notifications, newest first (API Spec NTF-01). */
export async function listNotifications(db: PrismaClient, actor: Actor, query: ListNotificationsQuery): Promise<NotificationPage> {
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    ...(query.unreadOnly && { readAt: null }),
    ...(after && { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] }),
  };

  // One row more than the page, to learn whether there is a next page.
  const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.createdAt, id: row.id }));
  return { items: page.map(toView), nextCursor };
}

/** Mark one read (API Spec NTF-02). Doing it again changes nothing, and the first read time is kept. */
export async function markRead(db: PrismaClient, actor: Actor, notificationId: string): Promise<void> {
  const row = await db.notification.findFirst({ where: { id: notificationId, userId: actor.id }, select: { id: true } });
  if (!row) throw new AppError('NOT_FOUND');
  await db.notification.updateMany({ where: { id: notificationId, readAt: null }, data: { readAt: new Date() } });
}

/** Mark all of the caller's unread notifications read (API Spec NTF-03). */
export async function markAllRead(db: PrismaClient, actor: Actor): Promise<ReadAllResult> {
  const { count } = await db.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  return { marked: count };
}

/** How many of the caller's notifications are unread (API Spec NTF-04). */
export async function unreadCount(db: PrismaClient, actor: Actor): Promise<UnreadCount> {
  return { count: await db.notification.count({ where: { userId: actor.id, readAt: null } }) };
}
