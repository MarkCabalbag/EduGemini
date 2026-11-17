// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { Me } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a fake that remembers who is signed in.

const person = (role: Me['role']): Me => ({
  id: '1c9f0f0e-6d1e-4d49-9a43-2a6f6b0c8a11',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role,
  emailVerified: false,
  suspended: false,
});

type Call = { path: string; method: string; body?: unknown };
let calls: Call[];
let me: Me | null;
let previewResult: () => Response;
let joinResult: () => Response;

const PREVIEW = { className: 'Biology 101', instructorFirstName: 'Maria', requireApproval: false };

beforeEach(() => {
  calls = [];
  me = null;
  previewResult = () => Response.json(PREVIEW);
  joinResult = () => Response.json({ classId: crypto.randomUUID(), className: 'Biology 101', status: 'ACTIVE' }, { status: 201 });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (path === '/me') return me ? Response.json(me) : failure(401, 'UNAUTHENTICATED');
      if (path === '/auth/signin' || path === '/auth/signup') {
        me = person('STUDENT');
        return Response.json(me);
      }
      if (method === 'GET' && path.startsWith('/join/')) return previewResult();
      if (method === 'POST' && path === '/join') return joinResult();
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The header has a Sign in link too, so links on the page itself are looked for inside <main>.
const page = () => within(screen.getByRole('main'));
/** Shows the router state of the current history entry, so a test can see whether the page used it up. */
function StateProbe() {
  return <output data-testid="state">{JSON.stringify(useLocation().state)}</output>;
}

/** Like renderAt, but the first history entry carries router state, as it does right after signing in. */
function renderWithState(path: string, state: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <App />
        <StateProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const joins = () => calls.filter((c) => c.method === 'POST' && c.path === '/join');

describe('join link, signed out', () => {
  it('shows the class and its instructor\'s first name, and offers Sign up to join and Sign in', async () => {
    renderAt('/join/K7M2PQ9X');

    expect(await screen.findByRole('heading', { name: 'Biology 101' })).toBeTruthy();
    expect(screen.getByText('Taught by Maria')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign up to join' }).getAttribute('href')).toBe('/signup');
    expect(page().getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
    expect(calls.some((c) => c.path === '/join/K7M2PQ9X')).toBe(true);
    expect(joins()).toHaveLength(0);
  });

  it('keeps the code through sign-up, preselects Student, and joins when the account is made', async () => {
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    await user.click(await screen.findByRole('link', { name: 'Sign up to join' }));
    expect((await screen.findByLabelText<HTMLInputElement>('I am a Student')).checked).toBe(true);

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('You joined Biology 101.')).toBeTruthy();
    expect(joins()).toEqual([{ path: '/join', method: 'POST', body: { code: 'K7M2PQ9X' } }]);
  });

  it('keeps the code through sign-in, and joins when the student has signed in', async () => {
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    await user.click(await page().findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('You joined Biology 101.')).toBeTruthy();
    expect(joins()).toHaveLength(1);
  });

  it('keeps the code when the visitor goes from sign-up to sign-in', async () => {
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    await user.click(await screen.findByRole('link', { name: 'Sign up to join' }));
    await user.click(await page().findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('You joined Biology 101.')).toBeTruthy();
  });

  it('does not preselect a role when sign-up is opened on its own', async () => {
    renderAt('/signup');
    expect((await screen.findByLabelText<HTMLInputElement>('I am a Student')).checked).toBe(false);
  });

  it('shows the invalid-code message for a code that does not work, with nothing to join', async () => {
    previewResult = () => failure(404, 'INVALID_JOIN_CODE');
    renderAt('/join/NOSUCHCD');

    expect((await screen.findByRole('alert')).textContent).toContain("That code didn't work. Check it and try again.");
    expect(screen.queryByRole('link', { name: 'Sign up to join' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says what went wrong and lets the visitor try again when the server fails', async () => {
    previewResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    previewResult = () => Response.json(PREVIEW);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Biology 101' })).toBeTruthy();
  });
});

describe('join link, signed in', () => {
  it('lets a student press Join class, and does not join by itself', async () => {
    me = person('STUDENT');
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    const button = await screen.findByRole('button', { name: 'Join class' });
    expect(joins()).toHaveLength(0);
    await user.click(button);

    expect(await screen.findByText('You joined Biology 101.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join class' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to my dashboard' }).getAttribute('href')).toBe('/classes');
    expect(joins()).toHaveLength(1);
  });

  it('joins by itself right after sign-in, once, and uses the flag up so Back or a reload cannot join again', async () => {
    me = person('STUDENT');
    renderWithState('/join/K7M2PQ9X', { afterSignIn: true });

    expect(await screen.findByText('You joined Biology 101.')).toBeTruthy();
    // The history entry no longer says "just signed in". The router replaces it in a transition, which can finish just after the message shows.
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('null'));
    expect(joins()).toHaveLength(1);
  });

  it('asks for the code in capitals whatever case the link has', async () => {
    me = person('STUDENT');
    const user = userEvent.setup();
    renderAt('/join/k7m2pq9x');

    await user.click(await screen.findByRole('button', { name: 'Join class' }));

    await screen.findByText('You joined Biology 101.');
    expect(calls.some((c) => c.method === 'GET' && c.path === '/join/K7M2PQ9X')).toBe(true);
    expect(joins()[0]?.body).toEqual({ code: 'K7M2PQ9X' });
  });

  it('tells an admin that only students can join, with no button', async () => {
    me = person('SUPER_ADMIN');
    renderAt('/join/K7M2PQ9X');

    expect(await screen.findByText('Only student accounts can join classes.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join class' })).toBeNull();
    expect(joins()).toHaveLength(0);
  });

  it('says Pending approval when the class needs the instructor to approve', async () => {
    me = person('STUDENT');
    joinResult = () => Response.json({ classId: crypto.randomUUID(), className: 'Biology 101', status: 'PENDING' }, { status: 201 });
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    await user.click(await screen.findByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('status')).textContent).toContain('Pending approval.');
  });

  it('shows a refused join above the button and lets the student try again', async () => {
    me = person('STUDENT');
    joinResult = () => failure(403, 'JOIN_BLOCKED');
    const user = userEvent.setup();
    renderAt('/join/K7M2PQ9X');

    await user.click(await screen.findByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('alert')).textContent).toContain("You can't join this class right now. Contact the instructor.");
    expect(screen.getByRole('button', { name: 'Join class' })).toBeTruthy();
  });

  it('tells an instructor that instructor accounts cannot join', async () => {
    me = person('INSTRUCTOR');
    previewResult = () => failure(403, 'INSTRUCTOR_CANNOT_JOIN');
    renderAt('/join/K7M2PQ9X');

    expect((await screen.findByRole('alert')).textContent).toContain("Instructor accounts can't join classes.");
    expect(screen.queryByRole('button', { name: 'Join class' })).toBeNull();
  });
});
