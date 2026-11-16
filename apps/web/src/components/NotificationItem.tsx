import { Link } from 'react-router';
import type { Notification } from '@edugemini/shared';
import { relativeTime } from '../lib/relative-time';

/**
 * One notification (UX Brief §7). Unread is shown by a dot and bold text, and said to screen readers too, so it is not
 * colour alone. It opens the item it is about, and `onOpen` is called when that opens an unread one. The link carries
 * `fromNotification`, so a target that is gone says "This item is no longer available" (App Flow §10).
 */
export function NotificationItem({ item, onOpen }: { item: Notification; onOpen: () => void }) {
  const unread = item.readAt === null;

  return (
    <Link
      to={item.link}
      state={{ fromNotification: true }}
      onClick={() => unread && onOpen()}
      className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface p-4 hover:border-input-border"
    >
      <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${unread ? 'bg-primary' : ''}`} />
      <span className="min-w-0 flex-1">
        {unread && <span className="sr-only">Unread: </span>}
        <span className={`block ${unread ? 'font-semibold' : ''}`}>{item.title}</span>
        {item.body && <span className="block text-muted">{item.body}</span>}
        <time dateTime={item.createdAt} className="block text-small text-muted">
          {relativeTime(item.createdAt)}
        </time>
      </span>
    </Link>
  );
}
