import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { ListNotificationsQuerySchema, NotificationParamsSchema } from '@edugemini/shared';
import { limiters } from '../middleware/rate-limit';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import { listNotifications, markAllRead, markRead, unreadCount } from '../services/notification-service';

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const list = { query: ListNotificationsQuerySchema };
const one = { params: NotificationParamsSchema };
const none = {};

/**
 * The caller's own notifications (API Spec NTF-01 to NTF-04). Any signed-in user may use them, so there is no role check;
 * the service limits every query to the caller's rows. They have an A12 row of their own (300 a minute, one count for the
 * four routes), so this router is mounted BEFORE the general limit. The limit comes first, so a signed-out caller is counted by IP.
 */
export function notificationsRouter({ db }: { db: PrismaClient }): Router {
  const router = Router();
  router.use('/notifications', limiters.notificationsByUser(), requireAuth);

  router.get('/notifications', validate(list), async (req, res) => {
    const { query } = validated(res, list);
    res.json(await listNotifications(db, req.auth!.user, query));
  });

  router.get('/notifications/unread-count', validate(none), async (req, res) => {
    res.json(await unreadCount(db, req.auth!.user)); // Express sends the ETag and answers 304 to If-None-Match (API Spec NTF-04)
  });

  router.post('/notifications/read-all', validate(none), async (req, res) => {
    res.json(await markAllRead(db, req.auth!.user));
  });

  router.post('/notifications/:notificationId/read', validate(one), async (req, res) => {
    const { params } = validated(res, one);
    await markRead(db, req.auth!.user, params.notificationId);
    res.status(204).end();
  });

  return router;
}
