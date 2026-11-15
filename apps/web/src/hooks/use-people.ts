import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveAllResult,
  ClassSettingsResult,
  ClassSummary,
  Decision,
  EnrollmentStatus,
  EnrollmentView,
  PeoplePage,
} from '@edugemini/shared';
import { api } from '../lib/api';
import { classKeys } from './use-classes';

// The people lists sit under the class's own key, so refreshing the class refreshes them too.
const peopleKey = (classId: string, status: EnrollmentStatus) => [...classKeys.one(classId), 'people', status] as const;

/** The students of one class in one state, oldest first, a page at a time (API Spec PPL-01). */
export function usePeople(classId: string, status: EnrollmentStatus) {
  return useInfiniteQuery({
    queryKey: peopleKey(classId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<PeoplePage>(`/classes/${classId}/people?status=${status}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Whatever changed, the class (its counts too) and its lists are read again, also after a failure: the page may be stale. */
function useRefreshClass(classId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: classKeys.one(classId) });
}

/** Turn join approval on or off (API Spec CLS-10). */
export function useClassSettings(classId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshClass(classId);
  return useMutation({
    mutationFn: (requireApproval: boolean) =>
      api<ClassSettingsResult>(`/classes/${classId}/settings`, { method: 'PATCH', body: { requireApproval } }),
    onSuccess: ({ requireApproval }) => {
      // The switch answers at once; the refresh that follows brings the counts.
      queryClient.setQueryData<ClassSummary>(classKeys.one(classId), (old) => old && { ...old, requireApproval });
    },
    onSettled: refresh,
  });
}

/** Approve, decline, reverse or remove one student (API Spec PPL-02). */
export function useDecision(classId: string) {
  const refresh = useRefreshClass(classId);
  return useMutation({
    mutationFn: ({ enrollmentId, action }: { enrollmentId: string } & Decision) =>
      api<EnrollmentView>(`/enrollments/${enrollmentId}/decision`, { method: 'POST', body: { action } }),
    onSettled: refresh,
  });
}

/** Approve everyone still pending (API Spec PPL-03). */
export function useApprovePending(classId: string) {
  const refresh = useRefreshClass(classId);
  return useMutation({
    mutationFn: () => api<ApproveAllResult>(`/classes/${classId}/approve-pending`, { method: 'POST' }),
    onSettled: refresh,
  });
}
