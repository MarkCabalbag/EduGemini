import { z } from 'zod';
import { NotificationTypeSchema } from './enums';
import { PageQuery } from './paging';

/** List notifications (API Spec NTF-01). `unreadOnly` arrives as text in the query string. */
export const ListNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  ...PageQuery,
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export const NotificationParamsSchema = z.object({ notificationId: z.uuid() });

/** A relative in-app path: it starts with `/` and not `//` (Backend Schema §4.20). */
export const RelativeLinkSchema = z.string().max(512).regex(/^\/(?!\/)/);

/** What a row keeps besides its link: the short labels its copy needs, never grades, feedback or file names (Backend Schema §4.20). */
export const NotificationPayloadSchema = z.object({ className: z.string().optional() });
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

/** One notification as its recipient sees it (API Spec A5). `body` is the class name when the event has one (UX Brief §11.6). */
export const NotificationSchema = z.object({
  id: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  link: RelativeLinkSchema,
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = z.object({ items: z.array(NotificationSchema), nextCursor: z.string().nullable() });
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/** Mark all read (API Spec NTF-03). */
export const ReadAllResultSchema = z.object({ marked: z.number().int().min(0) });
export type ReadAllResult = z.infer<typeof ReadAllResultSchema>;

/** Unread count (API Spec NTF-04). */
export const UnreadCountSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;
