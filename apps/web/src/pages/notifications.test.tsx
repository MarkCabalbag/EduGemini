// @vitest-environment jsdom
import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Me, Notification } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API is replaced, by a small fake that keeps the notifications in memory.

configure({ asyncUtilTimeout: 5000 }); // the first screen of a file can take over a second when the whole suite runs at once

const me: Me = {
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'STUDENT',
  emailVerified: true,
  suspended: false,
};

const HOUR_MS = 3_600_000;
const GONE_ASSIGNMENT = '9b1d6f0e-2a53-4c7e-8f41-5d2c7a9e3b60';

const item = (n: number, overrides: Partial<Notification> = {}): Notification => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  type: 'ASSIGNMENT_PUBLISHED',
  title: `Title ${n}`,
  body: null,
  link: '/classes',
  readAt: null,
  createdAt: new Date(Date.now() - n * HOUR_MS).toISOString(),
  ...overrides,
});

type Call = { method: string; path: string };

let calls: Call[];
let rows: Notification[]; // newest first, as the API lists them
let pageSize: number;
let readAllFailure: Response | undefined;
let listFailure: Response | undefined;
let signedOut: boolean;

const unread = () => rows.filter((row) => row.readAt === null).length;
const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

beforeEach(() => {
  calls = [];
  rows = [];
  pageSize = 25;
  readAllFailure = undefined;
  listFailure = undefined;
  signedOut = false;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { pathname, search, searchParams } = new URL(url, 'http://x');
      const path = pathname.replace('/api', '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path: path + search });

      if (path === '/me') return signedOut ? failure(401, 'UNAUTHENTICATED') : Response.json(me);
      if (path === '/notifications/unread-count') return Response.json({ count: unread() });
      if (method === 'GET' && path === '/notifications') {
        if (listFailure) return listFailure;
        const start = Number(searchParams.get('cursor') ?? 0);
        const next = start + pageSize;
        return Response.json({ items: rows.slice(start, next), nextCursor: next < rows.length ? String(next) : null });
      }
      if (method === 'POST' && path === '/notifications/read-all') {
        if (readAllFailure) return readAllFailure;
        const marked = unread();
        rows.forEach((row) => (row.readAt ??= new Date().toISOString()));
        return Response.json({ marked });
      }
      const one = /^\/notifications\/([^/]+)\/read$/.exec(path);
      if (method === 'POST' && one) {
        const row = rows.find((r) => r.id === one[1]);
        if (!row) return failure(404, 'NOT_FOUND');
        row.readAt ??= new Date().toISOString();
        return new Response(null, { status: 204 });
      }
      if (path === '/classes') return Response.json({ items: [], nextCursor: null });
      return failure(404, 'NOT_FOUND'); // including the assignment a notification points at, which is gone
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Notifications in the header', () => {
  it('shows the unread count, and links to the notification center', async () => {
    rows = [item(1), item(2), item(3, { readAt: new Date().toISOString() })];
    renderAt('/classes');

    const link = await screen.findByRole('link', { name: 'Notifications, 2 unread' });

    expect(link.getAttribute('href')).toBe('/notifications');
    expect(within(link).getByText('2')).toBeTruthy();
  });

  it('shows no number when nothing is unread', async () => {
    rows = [item(1, { readAt: new Date().toISOString() })];
    renderAt('/classes');

    const link = await screen.findByRole('link', { name: 'Notifications' });

    expect(link.textContent).toBe('Notifications'); // the word alone, no circled number
  });

  it('is not there for a signed-out visitor, and asks for nothing', async () => {
    signedOut = true;
    renderAt('/');

    expect((await screen.findAllByRole('link', { name: 'Sign in' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /^Notifications/ })).toBeNull();
    expect(calls.filter((c) => c.path.startsWith('/notifications'))).toHaveLength(0);
  });

  describe('polling (API Spec A13)', () => {
    const polls = () => callsTo('GET', '/notifications/unread-count').length;

    it('asks again every 60 seconds and shows the new count', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      rows = [item(1)];
      renderAt('/classes');
      await screen.findByRole('link', { name: 'Notifications, 1 unread' });
      expect(polls()).toBe(1);

      rows = [item(2), item(1)];
      await vi.advanceTimersByTimeAsync(59_000);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy();
      expect(polls()).toBe(2);
    });

    it('does not ask while the tab is hidden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderAt('/classes');
      await screen.findByRole('link', { name: 'Notifications' });
      expect(polls()).toBe(1);

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(polls()).toBe(1);
    });
  });
});

describe('the notification center (App Flow §10)', () => {
  it('lists newest first: unread in bold with a dot, the class name, and a relative time', async () => {
    rows = [
      item(2, { title: 'New assignment published', body: 'Biology 101' }),
      item(5, { title: 'Join request approved or declined', readAt: new Date().toISOString() }),
    ];
    renderAt('/notifications');

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    const items = await within(screen.getByRole('main')).findAllByRole('listitem'); // the header's nav is a list too
    expect(items).toHaveLength(2);

    const first = items[0]!;
    expect(within(first).getByText('New assignment published').className).toContain('font-semibold');
    expect(within(first).getByText('Unread:')).toBeTruthy(); // said in words too, not only by the bold text and the dot
    expect(within(first).getByText('Biology 101')).toBeTruthy();
    expect(within(first).getByText('2 hours ago')).toBeTruthy();
    expect(first.querySelector('.notif-row-dot.is-unread')).not.toBeNull(); // the red dot in the margin

    const second = items[1]!;
    expect(within(second).getByText('Join request approved or declined').className).not.toContain('font-semibold');
    expect(within(second).queryByText('Unread:')).toBeNull();
    expect(second.querySelector('.notif-row-dot.is-unread')).toBeNull();
    expect(within(second).getByText('5 hours ago')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
  });

  it('says "You\'re all caught up." when there is nothing', async () => {
    renderAt('/notifications');

    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('says what went wrong when the list fails, and Try again works', async () => {
    const user = userEvent.setup();
    listFailure = failure(500, 'INTERNAL');
    renderAt('/notifications');

    expect(await screen.findByText('Something went wrong on our side.')).toBeTruthy();
    expect(screen.queryByText("You're all caught up.")).toBeNull();

    rows = [item(1)];
    listFailure = undefined;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Title 1')).toBeTruthy();
  });

  it('marks all read: the button goes, the count goes, and nothing is bold any more', async () => {
    const user = userEvent.setup();
    rows = [item(1), item(2)];
    renderAt('/notifications');

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull());
    expect(callsTo('POST', '/notifications/read-all')).toHaveLength(1);
    expect(screen.queryByText('Unread:')).toBeNull();
    expect(screen.queryByText(/unread$/)).toBeNull();
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy(); // the header link lost its number too
  });

  it('says why when marking all read fails, and keeps the list', async () => {
    const user = userEvent.setup();
    rows = [item(1)];
    readAllFailure = failure(500, 'INTERNAL');
    renderAt('/notifications');

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    expect(await screen.findByText('Something went wrong on our side.')).toBeTruthy();
    expect(screen.getByText('Title 1')).toBeTruthy();
  });

  it('shows more with the next cursor', async () => {
    const user = userEvent.setup();
    pageSize = 2;
    rows = [item(1), item(2), item(3)];
    renderAt('/notifications');

    await screen.findByText('Title 2');
    expect(screen.queryByText('Title 3')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show more notifications' }));

    expect(await screen.findByText('Title 3')).toBeTruthy();
    expect(callsTo('GET', '/notifications?cursor=2')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show more notifications' })).toBeNull();
  });

  describe('opening an item', () => {
    it('goes to its link and marks it read', async () => {
      const user = userEvent.setup();
      rows = [item(1, { title: 'New assignment published', link: '/terms' })];
      renderAt('/notifications');

      await user.click(await screen.findByRole('link', { name: /New assignment published/ }));

      expect(await screen.findByRole('heading', { name: 'Terms of Use' })).toBeTruthy();
      await waitFor(() => expect(callsTo('POST', `/notifications/${rows[0]!.id}/read`)).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy()); // the count was read again: no number now
    });

    it('does not ask again for one that is already read', async () => {
      const user = userEvent.setup();
      rows = [item(1, { title: 'Old news', link: '/terms', readAt: new Date().toISOString() })];
      renderAt('/notifications');

      await user.click(await screen.findByRole('link', { name: /Old news/ }));

      expect(await screen.findByRole('heading', { name: 'Terms of Use' })).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    it('says "This item is no longer available." with a way back when the target is gone', async () => {
      const user = userEvent.setup();
      rows = [item(1, { title: 'New assignment published', link: `/assignments/${GONE_ASSIGNMENT}` })];
      renderAt('/notifications');

      await user.click(await screen.findByRole('link', { name: /New assignment published/ }));

      expect(await screen.findByRole('heading', { name: 'This item is no longer available.' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Go to dashboard' }).getAttribute('href')).toBe('/classes');
      await waitFor(() => expect(callsTo('POST', `/notifications/${rows[0]!.id}/read`)).toHaveLength(1)); // it was opened, so it is read
    });

    it('still says "We couldn\'t find that page." for a page that is gone when it was not opened from a notification', async () => {
      renderAt(`/assignments/${GONE_ASSIGNMENT}`);

      expect(await screen.findByRole('heading', { name: "We couldn't find that page." })).toBeTruthy();
    });
  });
});

describe('the notifications sheet under the header word', () => {
  const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.hover(await screen.findByRole('link', { name: /^Notifications/ }));
    return screen.findByRole('region', { name: 'Latest notifications' });
  };

  it('opens on hover with the newest five, and the word still links to the page', async () => {
    const user = userEvent.setup();
    rows = [1, 2, 3, 4, 5, 6].map((n) => item(n, { title: `Note ${n}`, readAt: n > 2 ? new Date().toISOString() : null }));
    renderAt('/classes');

    const sheet = await openSheet(user);

    expect(await within(sheet).findByText('Note 1')).toBeTruthy();
    expect(within(sheet).getByText('Note 5')).toBeTruthy();
    expect(within(sheet).queryByText('Note 6')).toBeNull();
    expect(within(sheet).getByText('2 new')).toBeTruthy();
    expect(within(sheet).getAllByText('Unread:')).toHaveLength(2);
    expect(within(sheet).getByRole('link', { name: 'See all notifications' }).getAttribute('href')).toBe('/notifications');
    expect(screen.getByRole('link', { name: 'Notifications, 2 unread' }).getAttribute('href')).toBe('/notifications');
  });

  it('marks one read when it is opened, and closes', async () => {
    const user = userEvent.setup();
    rows = [item(1, { title: 'New assignment published', link: '/terms' })];
    renderAt('/classes');

    const sheet = await openSheet(user);
    await user.click(await within(sheet).findByRole('link', { name: /New assignment published/ }));

    expect(await screen.findByRole('heading', { name: 'Terms of Use' })).toBeTruthy();
    await waitFor(() => expect(callsTo('POST', `/notifications/${rows[0]!.id}/read`)).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Latest notifications' })).toBeNull();
  });

  it('marks all read from the sheet', async () => {
    const user = userEvent.setup();
    rows = [item(1), item(2)];
    renderAt('/classes');

    const sheet = await openSheet(user);
    await user.click(await within(sheet).findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(callsTo('POST', '/notifications/read-all')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy());
  });

  it('opens by keyboard focus too, and Escape closes it with focus left on the word', async () => {
    const user = userEvent.setup();
    rows = [item(1, { title: 'Keyboard note' })];
    renderAt('/classes');

    const word = await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    word.focus();
    const sheet = await screen.findByRole('region', { name: 'Latest notifications' });
    expect(await within(sheet).findByText('Keyboard note')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Latest notifications' })).toBeNull();
    expect(document.activeElement).toBe(word);
  });

  it('closes on Escape after a pointer opened it, with no focus inside (WCAG 1.4.13)', async () => {
    const user = userEvent.setup();
    rows = [item(1)];
    renderAt('/classes');

    await openSheet(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Latest notifications' })).toBeNull();
  });

  it('says "All caught up" when there is nothing', async () => {
    const user = userEvent.setup();
    rows = [];
    renderAt('/classes');

    const sheet = await openSheet(user);

    expect(await within(sheet).findByText('All caught up')).toBeTruthy();
  });
});
