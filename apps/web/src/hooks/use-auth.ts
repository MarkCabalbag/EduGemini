import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, SignIn, SignUp } from '@edugemini/shared';
import { api, ApiRequestError } from '../lib/api';
import { meKeys, setSignedInUser } from '../lib/query-client';

/** The signed-in user, or null when signed out. A 401 is an answer, not an error. */
export function useMe() {
  return useQuery({
    queryKey: meKeys.all,
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignIn) => api<Me>('/auth/signin', { method: 'POST', body: input }),
    onSuccess: (me) => setSignedInUser(queryClient, me),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignUp) => api<Me>('/auth/signup', { method: 'POST', body: input }),
    onSuccess: (me) => setSignedInUser(queryClient, me),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/signout', { method: 'POST' }),
    onSuccess: () => setSignedInUser(queryClient, null),
  });
}
