import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../hooks/use-auth';
import { safeReturnPath } from '../lib/return-path';
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

/**
 * For the landing, sign-in and sign-up pages. A signed-in user is sent on: back to where they were headed,
 * or to the dashboard. Signing in only has to update the cached user; this redirect does the rest.
 */
export function PublicOnly() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageLoading />;
  if (me.data) return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />;
  return <Outlet />;
}
