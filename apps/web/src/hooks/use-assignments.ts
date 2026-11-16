import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentDetail,
  AssignmentPage,
  AssignmentStatus,
  CreateAssignment,
  PublishedAssignment,
  UpdateAssignment,
} from '@edugemini/shared';
import { api } from '../lib/api';

export const assignmentKeys = {
  all: ['assignments'] as const,
  lists: () => [...assignmentKeys.all, 'list'] as const,
  list: (classId: string, status: AssignmentStatus) => [...assignmentKeys.lists(), classId, status] as const,
  one: (assignmentId: string) => [...assignmentKeys.all, 'one', assignmentId] as const,
};

/** One status of a class's assignments, nearest due date first, one page at a time (API Spec ASG-01). Instructors only for now. */
export function useAssignments(classId: string, status: AssignmentStatus) {
  return useInfiniteQuery({
    queryKey: assignmentKeys.list(classId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ status });
      if (pageParam) query.set('cursor', pageParam);
      return api<AssignmentPage>(`/classes/${classId}/assignments?${query}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useAssignment(assignmentId: string) {
  return useQuery({ queryKey: assignmentKeys.one(assignmentId), queryFn: () => api<AssignmentDetail>(`/assignments/${assignmentId}`) });
}

/** Make a draft (API Spec ASG-02). The wizard opens the draft next, so it is already in hand. */
export function useCreateAssignment(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssignment) => api<AssignmentDetail>(`/classes/${classId}/assignments`, { method: 'POST', body: input }),
    onSuccess: (created) => {
      queryClient.setQueryData(assignmentKeys.one(created.id), created);
      void queryClient.invalidateQueries({ queryKey: assignmentKeys.lists() });
    },
  });
}

/** Save changes to a draft (API Spec ASG-04). */
export function useUpdateAssignment(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateAssignment) => api<AssignmentDetail>(`/assignments/${assignmentId}`, { method: 'PATCH', body: changes }),
    onSuccess: (saved) => {
      queryClient.setQueryData(assignmentKeys.one(assignmentId), saved);
      void queryClient.invalidateQueries({ queryKey: assignmentKeys.lists() });
    },
  });
}

/**
 * Publish a draft (API Spec ASG-06). The answer carries the warnings. The cached assignment is read again instead of
 * replaced, so the wizard does not switch to its "already published" message before the page has moved on.
 */
export function usePublishAssignment(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<PublishedAssignment>(`/assignments/${assignmentId}/publish`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: assignmentKeys.all }),
  });
}
