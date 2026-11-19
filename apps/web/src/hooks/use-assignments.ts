import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentDetail,
  AssignmentPage,
  AssignmentStatus,
  CreateAssignment,
  PublishedAssignment,
  ReferenceFileLink,
  ReferenceFileView,
  UpdateAssignment,
} from '@edugemini/shared';
import { api } from '../lib/api';

const assignmentKeys = {
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

/** Add a reference file to a draft (API Spec REF-01). The file goes inside a form; the assignment is read again afterwards, so its list shows the file. */
export function useAddReferenceFile(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<ReferenceFileView>(`/assignments/${assignmentId}/reference-files`, { method: 'POST', body: form });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: assignmentKeys.one(assignmentId) }),
  });
}

/** Show a reference file to students or hide it (API Spec REF-02). */
export function useSetReferenceVisibility(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, visibleToStudents }: { fileId: string; visibleToStudents: boolean }) =>
      api<ReferenceFileView>(`/reference-files/${fileId}`, { method: 'PATCH', body: { visibleToStudents } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: assignmentKeys.one(assignmentId) }),
  });
}

/** Remove a reference file from a draft (API Spec REF-03). */
export function useRemoveReferenceFile(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => api(`/reference-files/${fileId}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: assignmentKeys.one(assignmentId) }),
  });
}

/**
 * Open a reference file in a new tab (API Spec REF-04). The link lasts five minutes, so it is asked for when the button is
 * pressed. The tab is opened first, in the click itself, because a browser blocks a tab opened after a wait.
 */
export function useOpenReferenceFile() {
  return useMutation({
    mutationFn: async (fileId: string) => {
      const tab = window.open('about:blank', '_blank');
      try {
        const { url } = await api<ReferenceFileLink>(`/reference-files/${fileId}/url`);
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          window.open(url, '_blank', 'noopener');
        }
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });
}
