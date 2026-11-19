import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { Link } from 'react-router';
import type { Notification } from '@edugemini/shared';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks/use-notifications';
import { errorTextOf } from '../lib/error-text';
import { relativeTime } from '../lib/relative-time';
import { NotificationsLink } from './NotificationsLink';

/** How many of the newest notifications the sheet shows; the rest are on the Notifications page. */
const SHOWN = 5;
/** A pointer resting this long on the word opens the sheet, so passing over it does not flash it (taste-skill motion). */
const OPEN_DELAY_MS = 150;
/** Leaving the word or the sheet closes it after this long, so a slightly wobbly path into the sheet keeps it open. */
const CLOSE_DELAY_MS = 120;

/** One notification on the sheet: unread has a red dot in the margin and a bold title, and says "Unread" to screen readers. */
function SheetItem({ item, onOpen }: { item: Notification; onOpen: () => void }) {
  const unread = item.readAt === null;
  return (
    <Link to={item.link} state={{ fromNotification: true }} onClick={onOpen} className="sheet-item">
      <span aria-hidden className={`sheet-dot ${unread ? 'is-unread' : ''}`} />
      <span className="min-w-0">
        {unread && <span className="sr-only">Unread: </span>}
        <span className={`block ${unread ? 'font-bold text-fg' : 'text-muted'}`}>{item.title}</span>
        {item.body && <span className="block truncate text-[0.9375rem] text-muted">{item.body}</span>}
      </span>
      <time dateTime={item.createdAt} className="font-hand text-xl whitespace-nowrap text-[var(--pencil,var(--text-muted))]">
        {relativeTime(item.createdAt)}
      </time>
    </Link>
  );
}

/** The sheet's contents, loaded when it opens: the newest few, or why there are none, or what failed. */
function NotificationsSheet({ onNavigate }: { onNavigate: () => void }) {
  const notifications = useNotifications();
  const unread = useUnreadCount().data?.count ?? 0;
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const items = notifications.data?.pages[0]?.items.slice(0, SHOWN) ?? [];

  return (
    <div className="notif-sheet" role="region" aria-label="Latest notifications">
      <div className="notif-sheet-head">
        <p>
          <span className="font-bold">Notifications</span>
          {unread > 0 && <span className="ml-2 font-hand text-[1.375rem] text-[var(--margin-red,var(--primary))]">{unread} new</span>}
        </p>
        {unread > 0 && (
          <button type="button" className="notif-sheet-link" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            Mark all read
          </button>
        )}
      </div>
      {markAllRead.isError && <p className="notif-sheet-pad text-error-fg">{errorTextOf(markAllRead.error)}</p>}

      {notifications.isPending && (
        <ul aria-hidden className="space-y-[18px] py-[18px]">
          {[0, 1].map((n) => (
            <li key={n} className="notif-sheet-pad space-y-3">
              <span className="block h-3 w-2/3 bg-border" />
              <span className="block h-2.5 w-2/5 bg-border/60" />
            </li>
          ))}
        </ul>
      )}
      {notifications.isError && (
        <div className="notif-sheet-pad py-[18px]">
          <p className="text-error-fg">{errorTextOf(notifications.error)}</p>
          <button type="button" className="notif-sheet-link" onClick={() => void notifications.refetch()}>
            Try again
          </button>
        </div>
      )}
      {notifications.isSuccess && items.length === 0 && (
        <div className="notif-sheet-pad py-[18px]">
          <p className="inline-flex items-center gap-2 font-hand text-[1.75rem] text-[var(--margin-red,var(--primary))]">
            <Check aria-hidden size={24} strokeWidth={3} />
            All caught up
          </p>
          <p className="text-muted">New grades, join requests and assignments show up here.</p>
        </div>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <SheetItem
                item={item}
                onOpen={() => {
                  if (item.readAt === null) markRead.mutate(item.id);
                  onNavigate();
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="notif-sheet-foot">
        <Link to="/notifications" className="notif-sheet-link" onClick={onNavigate}>
          See all notifications
        </Link>
      </div>
    </div>
  );
}

/**
 * "Notifications" in the header with its sheet: resting the pointer on the word, or focusing it, drops a small ruled sheet
 * with the newest notifications under it; the word itself still opens the Notifications page. The pointer can travel into
 * the sheet (a short close delay and a bridge over the gap), Escape closes it and leaves focus on the word, and focus
 * leaving both closes it (WCAG 1.4.13). Desktop only: on phones the word lives in the menu and opens the page.
 */
export function NotificationsMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const word = useRef<HTMLLIElement>(null);
  // Set by Escape: the sheet stays shut while focus and the pointer stay here, so handing focus back to the word does not reopen it.
  const dismissed = useRef(false);

  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape dismisses the sheet wherever focus is, since a pointer can open it without focus ever arriving here (WCAG 1.4.13).
  // Focus inside the sheet goes back to the word; the sheet then stays shut until focus or the pointer leaves.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismissed.current = true;
      window.clearTimeout(timer.current);
      setOpen(false);
      if (word.current?.contains(document.activeElement)) word.current.querySelector('a')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    dismissed.current = false;
    close();
  };

  return (
    <li
      ref={word}
      className="relative"
      onMouseEnter={() => {
        if (!dismissed.current) later(true, OPEN_DELAY_MS);
      }}
      onMouseLeave={() => {
        dismissed.current = false;
        later(false, CLOSE_DELAY_MS);
      }}
      onFocus={() => {
        if (!dismissed.current) setOpen(true);
      }}
      onBlur={onBlur}
    >
      <NotificationsLink className={className} onClick={close} />
      {open && <NotificationsSheet onNavigate={close} />}
    </li>
  );
}
