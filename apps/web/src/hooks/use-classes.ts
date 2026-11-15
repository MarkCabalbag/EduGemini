import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClassPage, ClassSummary, CreateClass, EnrolledPage, Join, JoinPreview, JoinResult } from '@edugemini/shared';
import { api } from '../lib/api';

export const classKeys = {
  all: ['classes'] as const,
  lists: () => [...classKeys.all, 'list'] as const,
  one: (classId: string) => [...classKeys.all, 'one', classId] as const,
};

const enrollmentsKey = ['enrollments'] as const;

/** The instructor's own active classes, one page at a time (API Spec CLS-01). */
export function useClasses() {
  return useInfiniteQuery({
    queryKey: classKeys.lists(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<ClassPage>(pageParam ? `/classes?cursor=${encodeURIComponent(pageParam)}` : '/classes'),
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
