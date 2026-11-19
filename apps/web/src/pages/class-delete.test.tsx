// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassDeletionImpact, ClassSummary, Me } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a fake.

const me: Me = {
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Cruz',
  role: 'INSTRUCTOR',
  emailVerified: true,
  suspended: false,
};

const aClass = (overrides: Partial<ClassSummary> = {}): ClassSummary => ({
  id: crypto.randomUUID(),
  name: 'Biology 101',
  description: null,
  section: null,
  subject: null,
  room: null,
  status: 'ACTIVE',
  joinCode: 'K7M2PQ9X',
  joinLink: 'http://localhost:5173/join/K7M2PQ9X',
  joinCodeActive: true,
  requireApproval: false,
  ...overrides,
});

const IMPACT: ClassDeletionImpact = { students: 12, approvedStudents: 10, pendingStudents: 2, assignments: 3, submissions: 1, files: 4 };

type Call = { path: string; method: string; body?: unknown };
let calls: Call[];
let cls: ClassSummary;
let deleteResult: () => Response;

beforeEach(() => {
  calls = [];
  cls = aClass();
  deleteResult = () => new Response(null, { status: 204 });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });

      if (path === '/me') return Response.json(me);
      if (method === 'GET' && path === `/classes/${cls.id}`) return Response.json(cls);
      if (method === 'GET' && path === `/classes/${cls.id}/deletion-impact`) return Response.json(IMPACT);
      if (method === 'GET' && path === '/classes') return Response.json({ items: [], nextCursor: null });
      if (method === 'POST' && path === `/classes/${cls.id}/archive`) return Response.json({ ...cls, status: 'ARCHIVED' });
      if (method === 'DELETE' && path === `/classes/${cls.id}`) return deleteResult();
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const deletes = () => calls.filter((c) => c.method === 'DELETE');
const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Delete class' }));
  return screen.getByRole('dialog', { name: 'Delete Biology 101?' });
};

describe('delete class', () => {
  it('asks first with the counts, and nothing is sent on Cancel', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(/This deletes 12 students, 3 assignments and 1 submission, with all their files/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it('keeps Delete class off until the exact name is typed, then deletes and goes to the class list', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    const dialog = await openDialog(user);
    await within(dialog).findByText(/This deletes/);
    const confirm = within(dialog).getByRole('button', { name: 'Delete class' }) as HTMLButtonElement;
    const field = within(dialog).getByLabelText('Type Biology 101 to confirm');

    expect(confirm.disabled).toBe(true);
    await user.type(field, 'biology 101');
    expect(confirm.disabled).toBe(true); // the case counts
    await user.clear(field);
    await user.type(field, 'Biology 101');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    expect(await screen.findByRole('heading', { name: 'My classes' })).toBeTruthy();
    expect(deletes()).toEqual([{ path: `/classes/${cls.id}`, method: 'DELETE', body: { confirmation: 'Biology 101' } }]);
  });

  it('offers Archive instead, which archives and closes the dialog without deleting', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Archive instead' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ path: `/classes/${cls.id}/archive`, method: 'POST', body: undefined }]);
    expect(deletes()).toHaveLength(0);
  });

  it('does not offer Archive instead for a class that is already archived, and can still delete it', async () => {
    cls = aClass({ status: 'ARCHIVED' });
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    const dialog = await openDialog(user);

    expect(within(dialog).queryByRole('button', { name: 'Archive instead' })).toBeNull();
    expect(within(dialog).getByLabelText('Type Biology 101 to confirm')).toBeTruthy();
  });

  it('says what went wrong and stays on the page when the delete fails', async () => {
    deleteResult = () => failure(400, 'CONFIRMATION_MISMATCH');
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    const dialog = await openDialog(user);
    await within(dialog).findByText(/This deletes/);
    await user.type(within(dialog).getByLabelText('Type Biology 101 to confirm'), 'Biology 101');
    await user.click(within(dialog).getByRole('button', { name: 'Delete class' }));

    expect(await within(dialog).findByText('Type the exact name to confirm.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'My classes' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Delete Biology 101?' })).toBeTruthy();
  });
});
