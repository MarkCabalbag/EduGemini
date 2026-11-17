import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useMe, useSignOut } from '../hooks/use-auth';
import { NotificationBell } from './NotificationBell';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';

/** The page frame: a header with the wordmark and the account actions, and a centered column (UX Brief §6). */
export function Layout() {
  const { data: me, isPending, isError } = useMe();
  const signOut = useSignOut();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const shownPath = useRef(pathname);

  // On a new page, focus moves to the content, so a screen reader starts there and the link that was clicked is not left
  // holding focus after it is gone (WCAG 2.4.3). Not on the first page, and not when only `?tab=` changes.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    main.current?.focus();
  }, [pathname]);

  // When /me fails (a suspended account, or a server problem) the session cookie may still be valid, so Sign out stays available.
  const canSignOut = Boolean(me) || isError;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-14 max-w-[1120px] items-center justify-between gap-4 px-4">
          <Link to="/" className="text-title font-semibold">
            EduGemini
          </Link>
          {canSignOut ? (
            <div className="flex items-center gap-3">
              {me && <NotificationBell />}
              {me?.role === 'INSTRUCTOR' && (
                <Link to="/settings/ai" className="font-semibold text-primary underline">
                  Settings
                </Link>
              )}
              {me && (
                <span className="hidden text-small text-muted sm:inline">
                  {me.firstName} {me.lastName}
                </span>
              )}
              <Button variant="secondary" loading={signOut.isPending} onClick={() => signOut.mutate()}>
                Sign out
              </Button>
            </div>
          ) : (
            !isPending && (
              <Link to="/signin" className="font-semibold text-primary underline">
                Sign in
              </Link>
            )
          )}
        </div>
      </header>
      <main ref={main} tabIndex={-1} className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-8">
        {signOut.isError && <Alert>We could not sign you out. Check your connection and try again.</Alert>}
        <Outlet />
      </main>
    </div>
  );
}
