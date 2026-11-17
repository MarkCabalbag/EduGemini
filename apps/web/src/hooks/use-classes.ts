import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClassDeletionImpact,
  ClassPage,
  ClassStatus,
  ClassSummary,
  CreateClass,
  EnrolledPage,
  Join,
  JoinPreview,
  JoinResult,
  UpdateClass,
} from '@edugemini/shared';
import { api } from '../lib/api';

export const classKeys = {
  all: ['classes'] as const,
  lists: () => [...classKeys.all, 'list'] as const,
  one: (classId: string) => [...classKeys.all, 'one', classId] as const,
};

const enrollmentsKey = ['enrollments'] as const;

/** The instructor's own classes, active ones unless archived are asked for, one page at a time (API Spec CLS-01). */
export function useClasses(status: ClassStatus = 'ACTIVE') {
  return useInfiniteQuery({
    queryKey: [...classKeys.lists(), status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (status === 'ARCHIVED') query.set('status', status);
      if (pageParam) query.set('cursor', pageParam);
      return api<ClassPage>(`/classes${query.size > 0 ? `?${query}` : ''}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useClass(classId: string) {
  return useQuery({ queryKey: classKeys.one(classId), queryFn: () => api<ClassSummary>(`/classes/${classId}`) });
}

/** What a join link shows (API Spec JOIN-02). A signed-out visitor may ask. */
export function useJoinPreview(code: string) {
  return useQuery({ queryKey: ['join', code], queryFn: () => api<JoinPreview>(`/join/${encodeURIComponent(code)}`) });
}

/** The student's own classes with their status, one page at a time (API Spec JOIN-03). */
export function useEnrollments() {
  return useInfiniteQuery({
    queryKey: enrollmentsKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<EnrolledPage>(pageParam ? `/me/enrollments?cursor=${encodeURIComponent(pageParam)}` : '/me/enrollments'),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Join a class by its code (API Spec JOIN-01). The class then shows in the student's list. */
export function useJoinClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Join) => api<JoinResult>('/join', { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: enrollmentsKey }),
  });
}

/** Archive (true) or restore (false) a class (API Spec CLS-05, CLS-06). The class and every list of classes are read again. */
export function useArchiveClass(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archive: boolean) => api<ClassSummary>(`/classes/${classId}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: classKeys.all }),
  });
}

/** What deleting the class removes, for the confirmation dialog (API Spec CLS-11). Asked for only while the dialog is open, and never cached: the counts are read fresh each time. */
export function useDeletionImpact(classId: string) {
  return useQuery({
    queryKey: [...classKeys.one(classId), 'deletion-impact'],
    queryFn: () => api<ClassDeletionImpact>(`/classes/${classId}/deletion-impact`),
    gcTime: 0,
  });
}

/** Delete the class and everything in it (API Spec CLS-07). The lists of classes are read again; the class page itself is left alone, because the page leaves it. */
export function useDeleteClass(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (confirmation: string) => api(`/classes/${classId}`, { method: 'DELETE', body: { confirmation } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classKeys.lists() }),
  });
}

/** Regenerate the class code, or disable it (API Spec CLS-08, CLS-09). The class and every list of classes are read again. */
export function useChangeCode(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'regenerate' | 'disable') => api<ClassSummary>(`/classes/${classId}/code/${action}`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: classKeys.all }),
  });
}

/** Change a class's details (API Spec CLS-04). The class and every list of classes are read again, so the new name shows everywhere. */
export function useUpdateClass(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateClass) => api<ClassSummary>(`/classes/${classId}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classKeys.all }),
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClass) => api<ClassSummary>('/classes', { method: 'POST', body: input }),
    onSuccess: (created) => {
      queryClient.setQueryData(classKeys.one(created.id), created); // the class page opens next, with the class already in hand
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}
