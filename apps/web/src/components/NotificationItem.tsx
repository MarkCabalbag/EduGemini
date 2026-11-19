import { Link } from 'react-router';
import type { Notification } from '@edugemini/shared';
import { relativeTime } from '../lib/relative-time';

/**
 * One notification, written on the sheet (UX Brief §7): the title on one line, what it is about on the next, the time in the
 * teacher's hand on the right. Unread is shown by a red dot in the page's margin and bold text, and said to screen readers
 * too, so it is not colour alone. It opens the item it is about, and `onOpen` is called when that opens an unread one. The
 * link carries `fromNotification`, so a target that is gone says "This item is no longer available" (App Flow §10).
 */
export function NotificationItem({ item, onOpen }: { item: Notification; onOpen: () => void }) {
  const unread = item.readAt === null;

  return (
    <Link
      to={item.link}
      state={{ fromNotification: true }}
      onClick={() => unread && onOpen()}
      className="notif-row relative grid min-h-[72px] grid-cols-1 gap-x-6 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <span aria-hidden className={`notif-row-dot ${unread ? 'is-unread' : ''}`} />
      <span className="min-w-0">
        {unread && <span className="sr-only">Unread: </span>}
        <span className={`block ${unread ? 'font-semibold text-fg' : 'text-muted'}`}>{item.title}</span>
        {item.body && <span className="block text-[0.9375rem] text-muted">{item.body}</span>}
      </span>
      <time
        dateTime={item.createdAt}
        className="-order-1 font-hand text-xl leading-9 whitespace-nowrap text-[var(--pencil,var(--text-muted))] sm:order-none sm:text-[1.375rem]"
      >
        {relativeTime(item.createdAt)}
      </time>
    </Link>
  );
}
