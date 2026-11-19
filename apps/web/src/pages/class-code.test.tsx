// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassSummary, Me } from '@edugemini/shared';
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

const OLD_CODE = 'K7M2PQ9X';
const NEW_CODE = 'W4R8TN3B';
const aClass = (overrides: Partial<ClassSummary> = {}): ClassSummary => ({
  id: crypto.randomUUID(),
  name: 'Biology 101',
  description: null,
  section: null,
  subject: null,
  room: null,
  status: 'ACTIVE',
  joinCode: OLD_CODE,
  joinLink: `http://localhost:5173/join/${OLD_CODE}`,
  joinCodeActive: true,
  requireApproval: false,
  ...overrides,
});

type Call = { path: string; method: string };
let calls: Call[];
let cls: ClassSummary;
let changeResult: (action: 'regenerate' | 'disable') => Response;

beforeEach(() => {
  calls = [];
  cls = aClass();
  // Like the API: regenerate makes a new code and switches it on; disable switches it off and keeps the code.
  changeResult = (action) => {
    if (action === 'regenerate')
      Object.assign(cls, { joinCode: NEW_CODE, joinLink: `http://localhost:5173/join/${NEW_CODE}`, joinCodeActive: true });
    else cls.joinCodeActive = false;
    return Response.json(cls);
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      calls.push({ path, method });

      if (path === '/me') return Response.json(me);
      if (method === 'GET' && path === `/classes/${cls.id}`) return Response.json(cls);
      const change = /^\/classes\/[^/?]+\/code\/(regenerate|disable)$/.exec(path);
      if (method === 'POST' && change) return changeResult(change[1] as 'regenerate' | 'disable');
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const changes = () => calls.filter((c) => c.method === 'POST');
const codeValue = () => (screen.getByLabelText('Class code') as HTMLInputElement).value;
const linkValue = () => (screen.getByLabelText('Join link') as HTMLInputElement).value;

describe('class code card', () => {
  it('offers Regenerate code and Disable code beside the code and the link', async () => {
    renderAt(`/classes/${cls.id}`);

    expect(await screen.findByRole('heading', { name: 'Class code' })).toBeTruthy();
    expect(codeValue()).toBe(OLD_CODE);
    expect(screen.getByRole('button', { name: 'Regenerate code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable code' })).toBeTruthy();
  });

  it('asks before regenerating, says the members are not affected, and sends nothing on Cancel', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Regenerate code' }));
    const dialog = screen.getByRole('dialog', { name: 'Regenerate the class code?' });
    expect(within(dialog).getByText(/Students already in the class are not affected/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(changes()).toHaveLength(0);
    expect(codeValue()).toBe(OLD_CODE);
  });

  it('regenerates on confirm, and the card shows the new code and the link that follows it', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Regenerate code' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate code' }));

    expect(await screen.findByDisplayValue(NEW_CODE)).toBeTruthy();
    expect(linkValue()).toBe(`http://localhost:5173/join/${NEW_CODE}`);
    expect(changes()).toEqual([{ path: `/classes/${cls.id}/code/regenerate`, method: 'POST' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before disabling, says the members are not affected, and sends nothing on Cancel', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Disable code' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable the class code?' });
    expect(within(dialog).getByText(/Students already in the class are not affected/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(changes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Disable code' })).toBeTruthy();
  });

  it('disables on confirm: the code and link are no longer offered, and Regenerate code is how to turn it on again', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Disable code' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disable code' }));

    expect(await screen.findByText(/The class code is off/)).toBeTruthy();
    expect(changes()).toEqual([{ path: `/classes/${cls.id}/code/disable`, method: 'POST' }]);
    expect(screen.queryByLabelText('Class code')).toBeNull();
    expect(screen.queryByLabelText('Join link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable code' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Regenerate code' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate code' }));

    expect(await screen.findByDisplayValue(NEW_CODE)).toBeTruthy();
    expect(screen.queryByText(/The class code is off/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Disable code' })).toBeTruthy();
  });

  it('shows a class whose code is already off as off, with no code to copy', async () => {
    cls = aClass({ joinCodeActive: false });
    renderAt(`/classes/${cls.id}`);

    expect(await screen.findByText(/The class code is off/)).toBeTruthy();
    expect(screen.queryByLabelText('Class code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate code' })).toBeTruthy();
  });

  it('says what went wrong when the change fails, and the card stays as it was', async () => {
    changeResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Regenerate code' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate code' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(codeValue()).toBe(OLD_CODE);
  });

  it('is not offered on an archived class, which is read-only', async () => {
    cls = aClass({ status: 'ARCHIVED' });
    renderAt(`/classes/${cls.id}`);

    expect(await screen.findByRole('button', { name: 'Restore class' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Class code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable code' })).toBeNull();
  });
});
