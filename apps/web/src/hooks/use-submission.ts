import { useQuery } from '@tanstack/react-query';
import type { StudentSubmission } from '@edugemini/shared';
import { api } from '../lib/api';

export const submissionKeys = {
  mine: (assignmentId: string) => ['submissions', 'mine', assignmentId] as const,
};

/** The student's own submission for an assignment: state, files and attempts (API Spec SUB-01). */
export function useMySubmission(assignmentId: string) {
  return useQuery({ queryKey: submissionKeys.mine(assignmentId), queryFn: () => api<StudentSubmission>(`/assignments/${assignmentId}/me`) });
}
