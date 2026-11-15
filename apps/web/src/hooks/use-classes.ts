import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClassPage, ClassSummary, CreateClass } from '@edugemini/shared';
import { api } from '../lib/api';

export const classKeys = {
  all: ['classes'] as const,
  lists: () => [...classKeys.all, 'list'] as const,
  one: (classId: string) => [...classKeys.all, 'one', classId] as const,
};

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
