import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@edugemini/shared';
import { useMe } from '../hooks/use-auth';
import { safeReturnPath } from '../lib/return-path';
import { NoAccess } from '../pages/NoAccess';
import { ErrorState } from './ui/ErrorState';
import { PageLoading } from './ui/Skeleton';

/** For pages that need a signed-in user. A signed-out visitor goes to sign-in and comes back here afterwards (TRD §15.2). */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageLoading />;
  // A failed background refresh keeps the user we already know; only a first load that failed is an error screen.
  if (me.data === undefined && me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Inside `RequireAuth`, for pages of one role. Anyone else gets the no-access screen (TRD §15.2). The API refuses them too. */
export function RequireRole({ role }: { role: Role }) {
  const me = useMe().data;
  return me?.role === role ? <Outlet /> : <NoAccess />;
}

/**
 * For the landing, sign-in and sign-up pages. A signed-in user is sent on: back to where they were headed,
 * or to the dashboard. Signing in only has to update the cached user; this redirect does the rest.
 */
export function PublicOnly() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageLoading />;
  // `afterSignIn` tells the join page that this visitor has just signed in or signed up, so the join can go on by itself.
  if (me.data) {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace state={{ afterSignIn: true }} />;
  }
  return <Outlet />;
}
