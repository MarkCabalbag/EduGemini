// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TERMS_VERSION } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// The real components and routing run. Only the API, which is outside the web app, is replaced by a fake that
// remembers who is signed in.

const ADA = {
  id: '1c9f0f0e-6d1e-4d49-9a43-2a6f6b0c8a11',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'STUDENT',
  emailVerified: false,
  suspended: false,
};

const failure = (status: number, code: string, fields?: object) =>
  Response.json({ error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } }, { status });

type Call = { path: string; method: string; body?: unknown };
let calls: Call[];
let signedIn: boolean;
let signInResult: () => Response;
let signUpResult: () => Response;
let signOutResult: () => Response;
let meResult: () => Response;

beforeEach(() => {
  calls = [];
  signedIn = false;
  meResult = () => (signedIn ? Response.json(ADA) : failure(401, 'UNAUTHENTICATED'));
  signInResult = () => {
    signedIn = true;
    return Response.json(ADA);
  };
  signUpResult = () => {
    signedIn = true;
    return Response.json(ADA, { status: 201 });
  };
  signOutResult = () => {
    signedIn = false;
    return new Response(null, { status: 204 });
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (path === '/me') return meResult();
      if (path === '/auth/signin') return signInResult();
      if (path === '/auth/signup') return signUpResult();
      if (path === '/auth/signout') return signOutResult();
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

async function fillSignIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
  await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
}

describe('signed out', () => {
  it('sends a visitor of a protected page to sign in, and brings them back after', async () => {
    const user = userEvent.setup();
    renderAt('/classes');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeTruthy();
    expect(posts('/auth/signin')[0]?.body).toEqual({ email: 'ada@example.com', password: 'plum-violin-stapler' });
  });

  it('shows one generic message for a wrong password', async () => {
    signInResult = () => failure(401, 'INVALID_CREDENTIALS');
    const user = userEvent.setup();
    renderAt('/signin');

    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Email or password is incorrect.');
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull();
  });

  it('shows the landing page with sign up and sign in', async () => {
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Sign up' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('shows a not-found page for an unknown address', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: /couldn.t find that page/i })).toBeTruthy();
  });
});

describe('sign up', () => {
  it('names what is missing and sends nothing until the form is valid', async () => {
    const user = userEvent.setup();
    renderAt('/signup');

    await user.click(await screen.findByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('You must accept the Terms to continue')).toBeTruthy();
    expect(screen.getByText('Choose a role')).toBeTruthy();
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(2); // first and last name
    expect(posts('/auth/signup')).toHaveLength(0);
  });

  it('sends the role, the accepted Terms and their version, then lands on the dashboard', async () => {
    const user = userEvent.setup();
    renderAt('/signup');

    await user.type(await screen.findByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByLabelText('I am an Instructor'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeTruthy();
    expect(posts('/auth/signup')[0]?.body).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'plum-violin-stapler',
      role: 'INSTRUCTOR',
      acceptTerms: true,
      termsVersion: TERMS_VERSION,
    });
  });

  it('puts a duplicate-email answer under the email field', async () => {
    signUpResult = () => failure(409, 'EMAIL_TAKEN');
    const user = userEvent.setup();
    renderAt('/signup');

    await user.type(await screen.findByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByLabelText('I am a Student'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a problem with the hidden Terms version above the form', async () => {
    signUpResult = () => failure(422, 'VALIDATION', { termsVersion: 'The Terms have changed. Reload the page and try again.' });
    const user = userEvent.setup();
    renderAt('/signup');

    await user.type(await screen.findByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'plum-violin-stapler');
    await user.click(screen.getByLabelText('I am a Student'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The Terms have changed');
  });
});

describe('signed in', () => {
  beforeEach(() => {
    signedIn = true;
  });

  it('sends a signed-in user away from the sign-in page', async () => {
    renderAt('/signin');
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeTruthy();
  });

  it('signs out and returns the user to sign in when they open the dashboard again', async () => {
    const user = userEvent.setup();
    renderAt('/classes');

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(posts('/auth/signout')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('keeps the page when a background refresh of the user fails', async () => {
    const queryClient = renderAt('/classes');
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeTruthy();

    meResult = () => failure(500, 'INTERNAL');
    await queryClient.invalidateQueries({ queryKey: ['me'] });

    expect(screen.getByRole('heading', { name: 'Welcome, Ada' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets a suspended user sign out, since the session is still open', async () => {
    meResult = () => failure(403, 'ACCOUNT_SUSPENDED');
    renderAt('/classes');

    expect((await screen.findByRole('alert')).textContent).toContain('Account suspended.');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('tells the user when sign-out failed, and keeps them signed in', async () => {
    const user = userEvent.setup();
    signOutResult = () => failure(500, 'INTERNAL');
    renderAt('/classes');

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('could not sign you out');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
