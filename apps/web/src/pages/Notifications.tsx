import { Bell } from 'lucide-react';
import { NotificationItem } from '../components/NotificationItem';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks/use-notifications';
import { errorTextOf } from '../lib/error-text';

/** The notification center (App Flow §10): newest first, unread in bold with a dot, opening an item marks it read. */
export function Notifications() {
  const notifications = useNotifications();
  const unread = useUnreadCount().data?.count ?? 0;
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <title>Notifications · EduGemini</title>
          <h1 className="text-display font-semibold">Notifications</h1>
          {unread > 0 && <p className="text-muted">{unread.toLocaleString()} unread</p>}
        </div>
        {unread > 0 && (
          <Button variant="secondary" loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            Mark all read
          </Button>
        )}
      </div>
      {markAllRead.isError && <Alert>{errorTextOf(markAllRead.error)}</Alert>}
      {notifications.isPending && <PageLoading />}
      {/* A failed first load is an error screen; a failed "Show more" is said next to its button. */}
      {notifications.isError && !notifications.data && <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />}
      {notifications.isSuccess && items.length === 0 && (
        <EmptyState icon={Bell} action={null}>
          You&apos;re all caught up.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <NotificationItem item={item} onOpen={() => markRead.mutate(item.id)} />
            </li>
          ))}
        </ul>
      )}
      {notifications.isFetchNextPageError && (
        <Alert>{errorTextOf(notifications.error)}</Alert>
      )}
      {notifications.hasNextPage && (
        <Button variant="secondary" loading={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>
          Show more notifications
        </Button>
      )}
    </section>
  );
}
