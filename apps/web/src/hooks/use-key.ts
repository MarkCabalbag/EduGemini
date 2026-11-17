import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KeyStatus, SaveKey } from '@edugemini/shared';
import { api } from '../lib/api';

const keyKey = ['key'] as const;

/** The instructor's own key status, never the key itself (API Spec KEY-01). */
export function useKey() {
  return useQuery({ queryKey: keyKey, queryFn: () => api<KeyStatus>('/me/key') });
}

/** Save or replace the key (API Spec KEY-02). The answer is the new status. */
export function useSaveKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveKey) => api<KeyStatus>('/me/key', { method: 'PUT', body: input }),
    onSuccess: (status) => queryClient.setQueryData(keyKey, status),
  });
}

/** Remove the key (API Spec KEY-03). */
export function useRemoveKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/me/key', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keyKey }),
  });
}
