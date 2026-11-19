import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPage, ReadAllResult, UnreadCount } from '@edugemini/shared';
import { api } from '../lib/api';
import { POLL_MS } from '../lib/polling';

const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

/** The number in the header bell. It asks again every 60 seconds while the tab is visible (API Spec NTF-04, A13). */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => api<UnreadCount>('/notifications/unread-count'),
    refetchInterval: POLL_MS.notificationBadge,
  });
}

/** The caller's notifications, newest first, a page at a time (API Spec NTF-01). */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<NotificationPage>(pageParam ? `/notifications?cursor=${encodeURIComponent(pageParam)}` : '/notifications'),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Whatever changed, the list and the count are read again, also after a failure: they may be stale. */
function useRefreshNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

/** Mark one read (API Spec NTF-02). The refresh is set here, not in `mutate`, so it still runs after the page has been left. */
export function useMarkRead() {
  const refresh = useRefreshNotifications();
  return useMutation({
    mutationFn: (notificationId: string) => api(`/notifications/${notificationId}/read`, { method: 'POST' }),
    onSettled: refresh,
  });
}

/** Mark all read (API Spec NTF-03). */
export function useMarkAllRead() {
  const refresh = useRefreshNotifications();
  return useMutation({
    mutationFn: () => api<ReadAllResult>('/notifications/read-all', { method: 'POST' }),
    onSettled: refresh,
  });
}
