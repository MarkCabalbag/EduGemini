import { Loader2, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import type { Me } from '@edugemini/shared';
import { useMe, useSignOut } from '../hooks/use-auth';
import { NotificationsLink } from './NotificationsLink';
import { NotificationsMenu } from './NotificationsMenu';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';

/** The EduGemini mark: an E circled in the teacher's pen, the same hand as the circled score on sign-in. */
function BrandMark() {
  return (
    <span aria-hidden className="relative inline-flex size-[34px] items-center justify-center">
      <svg viewBox="0 0 34 34" className="absolute inset-0" fill="none" stroke="var(--margin-red, var(--primary))" strokeWidth="2.5">
        <path strokeLinecap="round" d="M9 6 C20 0 33 8 31 19 C29 30 13 34 5 25 C0 19 3 9 13 5" />
      </svg>
      E
    </span>
  );
}

/** The places every signed-in user goes. `className` styles them as header words or as rows of the phone menu. */
function MainLinks({ me, className, onNavigate }: { me: Me; className: string; onNavigate?: () => void }) {
  return (
    <>
      <li>
        <NavLink to="/classes" className={className} onClick={onNavigate}>
          Classes
        </NavLink>
      </li>
      {/* In the header bar the word drops the notifications sheet on hover or focus; in the phone menu it opens the page. */}
      {onNavigate ? (
        <li>
          <NotificationsLink className={className} onClick={onNavigate} />
        </li>
      ) : (
        <NotificationsMenu className={className} />
      )}
      {me.role === 'INSTRUCTOR' && (
        <li>
          <NavLink to="/settings/ai" className={className} onClick={onNavigate}>
            Settings
          </NavLink>
        </li>
      )}
    </>
  );
}

/** Sign out as a plain word in the account corner; the label stays while it works, with a spinner (UX Brief §7). */
function SignOutButton({ pending, onClick, className = '' }: { pending: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className={`inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline underline-offset-4 disabled:opacity-60 ${className}`}
    >
      {pending && <Loader2 aria-hidden size={18} className="animate-spin" />}
      Sign out
    </button>
  );
}

/**
 * The page frame (UX Brief §6): one sticky bar with the mark, the main places as words (the current one underlined), and
 * the account on the right; under 640 px the words and the account move into a full-screen menu. Then a centered column.
 */
export function Layout() {
  const { data: me, isPending, isError } = useMe();
  const signOut = useSignOut();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const shownPath = useRef(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  // On a new page, focus moves to the content, so a screen reader starts there and the link that was clicked is not left
  // holding focus after it is gone (WCAG 2.4.3). Not on the first page, and not when only `?tab=` changes.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    setMenuOpen(false);
    main.current?.focus();
  }, [pathname]);

  // Escape closes the phone menu and hands focus back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // When /me fails (a suspended account, or a server problem) the session cookie may still be valid, so Sign out stays available.
  const canSignOut = Boolean(me) || isError;
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex h-[71px] max-w-[1120px] items-center gap-10 px-4">
          <Link to="/" className="inline-flex items-center gap-2.5 text-title font-semibold">
            <BrandMark />
            EduGemini
          </Link>
          {me && (
            <nav aria-label="Main" className="hidden sm:block">
              <ul className="flex items-center gap-7">
                <MainLinks me={me} className="nav-word" />
              </ul>
            </nav>
          )}
          {canSignOut ? (
            <>
              <div className="ml-auto hidden items-center gap-5 sm:flex">
                {me && (
                  <span className="border-r border-border pr-5 text-small text-muted">
                    {me.firstName} {me.lastName}
                  </span>
                )}
                <SignOutButton pending={signOut.isPending} onClick={() => signOut.mutate()} />
              </div>
              <Button
                ref={menuButton}
                variant="secondary"
                className="ml-auto sm:hidden"
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
                {menuOpen ? 'Close' : 'Menu'}
              </Button>
            </>
          ) : (
            !isPending && (
              <Link to="/signin" className="ml-auto font-semibold text-primary underline underline-offset-4">
                Sign in
              </Link>
            )
          )}
        </div>
        {menuOpen && canSignOut && (
          <div id="site-menu" className="fixed inset-x-0 top-[72px] bottom-0 overflow-y-auto border-t border-border bg-surface sm:hidden">
            <ul>
              {me && <MainLinks me={me} className="menu-row" onNavigate={closeMenu} />}
              {me && (
                <li className="menu-row font-normal text-muted">
                  Signed in as {me.firstName} {me.lastName}
                </li>
              )}
              <li>
                <SignOutButton pending={signOut.isPending} onClick={() => signOut.mutate()} className="menu-row w-full" />
              </li>
            </ul>
          </div>
        )}
      </header>
      <main ref={main} tabIndex={-1} className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-8">
        {signOut.isError && <Alert>We could not sign you out. Check your connection and try again.</Alert>}
        <Outlet />
      </main>
    </div>
  );
}
