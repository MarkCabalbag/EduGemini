import { NavLink } from 'react-router';
import { useUnreadCount } from '../hooks/use-notifications';

/**
 * "Notifications" in the header: a link to the notification center with the unread count circled beside it, shown when
 * above zero (UX Brief §6.1). The count is in the link's name for screen readers; the circle itself is decoration.
 */
export function NotificationsLink({ className, onClick }: { className: string; onClick?: () => void }) {
  const count = useUnreadCount().data?.count ?? 0;

  return (
    <NavLink
      to="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className={className}
      onClick={onClick}
    >
      Notifications
      {count > 0 && (
        <span aria-hidden className="unread-count">
          {count.toLocaleString()}
        </span>
      )}
    </NavLink>
  );
}
