import { useQuery } from '@tanstack/react-query';
import type { StudentSubmission } from '@edugemini/shared';
import { api } from '../lib/api';
import { POLL_MS } from '../lib/polling';

export const submissionKeys = {
  mine: (assignmentId: string) => ['submissions', 'mine', assignmentId] as const,
};

/**
 * The student's own submission for an assignment: state, files, attempts and the result (API Spec SUB-01). It asks again
 * every 5 seconds while the state is Uploading or Grading, so the result appears without a refresh (A13).
 */
export function useMySubmission(assignmentId: string) {
  return useQuery({
    queryKey: submissionKeys.mine(assignmentId),
    queryFn: () => api<StudentSubmission>(`/assignments/${assignmentId}/me`),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'GRADING' || state === 'UPLOADING' ? POLL_MS.studentSubmission : false;
    },
  });
}
