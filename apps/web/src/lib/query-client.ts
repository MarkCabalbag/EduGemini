import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { Me } from '@edugemini/shared';
import { ApiRequestError } from './api';

export const meKeys = { all: ['me'] as const };

/**
 * Records who is signed in (or null for nobody) and drops everything else cached, so nobody sees another user's data.
 * (clear() would detach the pages watching "me", so they would never learn that the user changed.)
 */
export function setSignedInUser(client: QueryClient, me: Me | null) {
  client.setQueryData(meKeys.all, me);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== meKeys.all[0] });
}

/**
 * The app's one QueryClient.
 * - No retry for answers like 401 or 404; at most twice for network and server problems (code-standards §8).
 * - A 401 from any call means the session has ended (expired, or signed out elsewhere), so the cached user and
 *   everything else cached is cleared and the route guards send the visitor to sign in.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => endSessionOn401(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => endSessionOn401(client, error) }),
    defaultOptions: {
      queries: {
        retry: (failures, error) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && failures < 2,
      },
    },
  });
  return client;
}

function endSessionOn401(client: QueryClient, error: unknown) {
  if (error instanceof ApiRequestError && error.code === 'UNAUTHENTICATED') setSignedInUser(client, null);
}
