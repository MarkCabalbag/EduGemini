import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { useUnreadCount } from '../hooks/use-notifications';

/** The bell in the header: a link to the notification center with the unread count beside it, shown when above zero (UX Brief §6.1). */
export function NotificationBell() {
  const count = useUnreadCount().data?.count ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-border"
    >
      <Bell aria-hidden size={20} />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-0 top-0 min-w-5 rounded-full bg-primary px-1 text-center text-small font-semibold text-primary-fg"
        >
          {count.toLocaleString()}
        </span>
      )}
    </Link>
  );
}
