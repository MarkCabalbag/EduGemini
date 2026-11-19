import { Check } from 'lucide-react';
import { NotificationItem } from '../components/NotificationItem';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks/use-notifications';
import { usePaperPage } from '../hooks/use-paper-page';
import { errorTextOf } from '../lib/error-text';
import { PAPER_HEADING } from '../lib/paper';

/**
 * The notification center (App Flow §10), on the Marked Script paper: newest first, written on the sheet's lines, unread in
 * bold with a red dot in the margin, opening an item marks it read.
 */
export function Notifications() {
  usePaperPage();
  const notifications = useNotifications();
  const unread = useUnreadCount().data?.count ?? 0;
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="max-w-[47.5rem] space-y-[18px] pl-6 leading-9 sm:pl-12">
      <title>Notifications · EduGemini</title>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-[18px]">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className={PAPER_HEADING}>Notifications</h1>
          {unread > 0 && (
            <p className="font-hand text-[1.625rem] leading-9 text-[var(--margin-red,var(--primary))]">{unread.toLocaleString()} unread</p>
          )}
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
      {notifications.isError && !notifications.data && (
        <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
      )}
      {notifications.isSuccess && items.length === 0 && (
        <div>
          <p className="inline-flex items-center gap-2 font-hand text-[1.875rem] leading-9 text-[var(--margin-red,var(--primary))]">
            <Check aria-hidden size={26} strokeWidth={3} />
            You&apos;re all caught up.
          </p>
          <p className="text-muted">New grades, join requests and assignments show up here.</p>
        </div>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <NotificationItem item={item} onOpen={() => markRead.mutate(item.id)} />
            </li>
          ))}
        </ul>
      )}
      {notifications.isFetchNextPageError && <Alert>{errorTextOf(notifications.error)}</Alert>}
      {notifications.hasNextPage && (
        <Button variant="secondary" loading={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>
          Show more notifications
        </Button>
      )}
    </section>
  );
}
