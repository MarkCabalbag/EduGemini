// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Decision, EnrollmentStatus, Me } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API is replaced, by a small fake class that keeps its students in memory.

const CLASS_ID = '9b1d6f0e-2a53-4c7e-8f41-5d2c7a9e3b60';
const me: Me = {
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'INSTRUCTOR',
  emailVerified: true,
  suspended: false,
};

type Row = { id: string; name: string; status: EnrollmentStatus };
type Call = { method: string; path: string; body?: unknown };

const MAYA: Row = { id: '00000000-0000-4000-8000-000000000001', name: 'Maya Cruz', status: 'PENDING' };
const BEN: Row = { id: '00000000-0000-4000-8000-000000000002', name: 'Ben Ortiz', status: 'PENDING' };
const LIA: Row = { id: '00000000-0000-4000-8000-000000000003', name: 'Lia Tan', status: 'ACTIVE' };
const ZED: Row = { id: '00000000-0000-4000-8000-000000000004', name: 'Zed Park', status: 'DECLINED' };

const ENDS: Record<Decision['action'], EnrollmentStatus> = { APPROVE: 'ACTIVE', DECLINE: 'DECLINED', REVERSE: 'ACTIVE', REMOVE: 'REMOVED' };

let calls: Call[];
let rows: Row[];
let requireApproval: boolean;
let pageSize: number;
let decisionFailure: Response | undefined;
let settingsFailure: Response | undefined;

const count = (status: EnrollmentStatus) => rows.filter((row) => row.status === status).length;

beforeEach(() => {
  calls = [];
  rows = [MAYA, BEN, LIA, ZED].map((row) => ({ ...row }));
  requireApproval = true;
  pageSize = 100;
  decisionFailure = undefined;
  settingsFailure = undefined;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { pathname, search, searchParams } = new URL(url, 'http://x');
      const path = pathname.replace('/api', '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
      calls.push({ method, path: path + search, body });

      if (path === '/me') return Response.json(me);
      if (method === 'GET' && path === `/classes/${CLASS_ID}`) {
        return Response.json({
          id: CLASS_ID,
          name: 'Biology 101',
          description: null,
          section: null,
          subject: null,
          room: null,
          status: 'ACTIVE',
          joinCode: 'K7M2PQ9X',
          joinLink: 'http://localhost:5173/join/K7M2PQ9X',
          joinCodeActive: true,
          requireApproval,
          counts: { approved: count('ACTIVE'), pending: count('PENDING'), declined: count('DECLINED'), removed: count('REMOVED') },
        });
      }
      if (method === 'GET' && path === `/classes/${CLASS_ID}/people`) {
        const matching = rows.filter((row) => row.status === searchParams.get('status'));
        const start = Number(searchParams.get('cursor') ?? 0);
        const page = matching.slice(start, start + pageSize);
        const items = page.map((row) => ({
          id: row.id,
          student: { id: crypto.randomUUID(), displayName: row.name, email: `${row.name.split(' ')[0]!.toLowerCase()}@example.com` },
          status: row.status,
          joinedAt: new Date().toISOString(),
          decidedAt: null,
        }));
        return Response.json({ counts: {}, items, nextCursor: start + pageSize < matching.length ? String(start + pageSize) : null });
      }
      if (method === 'PATCH' && path === `/classes/${CLASS_ID}/settings`) {
        if (settingsFailure) return settingsFailure;
        requireApproval = (body as { requireApproval: boolean }).requireApproval;
        return Response.json({ requireApproval, pendingCount: count('PENDING') });
      }
      if (method === 'POST' && path === `/classes/${CLASS_ID}/approve-pending`) {
        const pending = rows.filter((row) => row.status === 'PENDING');
        pending.forEach((row) => (row.status = 'ACTIVE'));
        return Response.json({ approvedCount: pending.length });
      }
      const decision = /^\/enrollments\/([^/]+)\/decision$/.exec(path);
      if (method === 'POST' && decision) {
        if (decisionFailure) return decisionFailure;
        const row = rows.find((r) => r.id === decision[1]);
        if (!row) return failure(404, 'NOT_FOUND');
        row.status = ENDS[(body as Decision).action];
        return Response.json({ id: row.id, status: row.status });
      }
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const openPeople = () => renderAt(`/classes/${CLASS_ID}?tab=people`);

describe('class page sections', () => {
  it('opens on Overview, and People is one click away', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}`);

    expect((await screen.findByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByLabelText('Require approval to join')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'People' }));

    expect(await screen.findByLabelText('Require approval to join')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'People' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByLabelText('Class code')).toBeNull();
  });
});

describe('people: lists and counts', () => {
  it('shows the counts on the three lists, and starts with the pending requests', async () => {
    openPeople();

    expect(await screen.findByRole('button', { name: 'Pending (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approved (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Declined (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending (2)' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Maya Cruz')).toBeTruthy();
    expect(screen.getByText('maya@example.com')).toBeTruthy(); // name and email, nothing else
    expect(screen.getByText('Ben Ortiz')).toBeTruthy();
    expect(screen.queryByText('Lia Tan')).toBeNull();
  });

  it('starts with the approved students when nobody is waiting', async () => {
    rows = [{ ...LIA }];
    openPeople();

    expect(await screen.findByText('Lia Tan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approved (1)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches lists', async () => {
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByRole('button', { name: 'Declined (1)' }));

    expect(await screen.findByText('Zed Park')).toBeTruthy();
    expect(screen.queryByText('Maya Cruz')).toBeNull();
    expect(callsTo('GET', `/classes/${CLASS_ID}/people?status=DECLINED`)).toHaveLength(1);
  });

  it('says so when a list is empty', async () => {
    rows = [{ ...LIA }];
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByRole('button', { name: 'Pending (0)' }));

    expect(await screen.findByText('No one is waiting for approval.')).toBeTruthy();
  });

  it('shows more students on request, following the cursor', async () => {
    pageSize = 1;
    const user = userEvent.setup();
    openPeople();

    expect(await screen.findByText('Maya Cruz')).toBeTruthy();
    expect(screen.queryByText('Ben Ortiz')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show more students' }));

    expect(await screen.findByText('Ben Ortiz')).toBeTruthy();
    expect(screen.getByText('Maya Cruz')).toBeTruthy();
    expect(callsTo('GET', `/classes/${CLASS_ID}/people?status=PENDING&cursor=1`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show more students' })).toBeNull();
  });

  it('shows the class code and link when nobody has joined yet', async () => {
    rows = [];
    openPeople();

    expect(await screen.findByText('No students yet. Share the class code or join link to let students in.')).toBeTruthy();
    expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    expect((screen.getByLabelText('Join link') as HTMLInputElement).value).toBe('http://localhost:5173/join/K7M2PQ9X');
    expect(screen.queryByRole('button', { name: /^Pending/ })).toBeNull();
  });
});

describe('people: decisions', () => {
  it('approves a student, who moves to the approved list, and the counts follow', async () => {
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByRole('button', { name: 'Approve Maya Cruz' }));

    expect(await screen.findByRole('button', { name: 'Pending (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approved (2)' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Maya Cruz')).toBeNull());
    expect(callsTo('POST', `/enrollments/${MAYA.id}/decision`)[0]?.body).toEqual({ action: 'APPROVE' });
  });

  it.each([
    ['Pending (2)', 'Decline Ben Ortiz', BEN, 'DECLINE'],
    ['Approved (1)', 'Remove Lia Tan', LIA, 'REMOVE'],
    ['Declined (1)', 'Reverse Zed Park', ZED, 'REVERSE'],
  ] as const)('on the %s list, "%s" sends %s', async (list, button, row, action) => {
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByRole('button', { name: list }));
    await user.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => expect(callsTo('POST', `/enrollments/${row.id}/decision`)).toHaveLength(1));
    expect(callsTo('POST', `/enrollments/${row.id}/decision`)[0]?.body).toEqual({ action });
    await waitFor(() => expect(screen.queryByRole('button', { name: button })).toBeNull());
  });

  it('gives each list only its own actions', async () => {
    const user = userEvent.setup();
    openPeople();

    expect(await screen.findByRole('button', { name: 'Approve Maya Cruz' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline Maya Cruz' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Remove|Reverse) / })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Approved (1)' }));
    expect(await screen.findByRole('button', { name: 'Remove Lia Tan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Approve|Decline|Reverse) / })).toBeNull(); // not the "Declined (1)" filter
  });

  it('says so and refreshes the list when the student was changed by someone else (CONFLICT)', async () => {
    decisionFailure = failure(409, 'CONFLICT');
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByRole('button', { name: 'Approve Maya Cruz' }));

    expect((await screen.findByRole('alert')).textContent).toContain('That changed in the meantime. The list has been updated.');
    await waitFor(() => expect(callsTo('GET', `/classes/${CLASS_ID}/people?status=PENDING`).length).toBeGreaterThan(1)); // read again
  });
});

describe('people: join approval', () => {
  const switchLabel = 'Require approval to join';

  it('shows the switch as it is, with the note that students already in are not changed', async () => {
    openPeople();

    expect((await screen.findByLabelText(switchLabel) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Turning this on doesn't change students who are already approved.")).toBeTruthy();
  });

  it('turns approval on', async () => {
    requireApproval = false;
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByLabelText(switchLabel));

    await waitFor(() => expect((screen.getByLabelText(switchLabel) as HTMLInputElement).checked).toBe(true));
    expect(callsTo('PATCH', `/classes/${CLASS_ID}/settings`)[0]?.body).toEqual({ requireApproval: true });
  });

  it('offers "Approve all pending" only after approval is turned off with students still waiting', async () => {
    const user = userEvent.setup();
    openPeople();

    await screen.findByLabelText(switchLabel);
    expect(screen.queryByRole('button', { name: 'Approve all pending' })).toBeNull(); // approval is on

    await user.click(screen.getByLabelText(switchLabel));

    expect(await screen.findByRole('button', { name: 'Approve all pending' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('2 students are still waiting for approval.');
    expect(callsTo('PATCH', `/classes/${CLASS_ID}/settings`)[0]?.body).toEqual({ requireApproval: false });
    expect(count('PENDING')).toBe(2); // turning it off approved no one
  });

  it('approves everyone waiting, then stops offering it', async () => {
    const user = userEvent.setup();
    openPeople();
    await user.click(await screen.findByLabelText(switchLabel));

    await user.click(await screen.findByRole('button', { name: 'Approve all pending' }));

    expect(await screen.findByRole('button', { name: 'Pending (0)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approved (3)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve all pending' })).toBeNull();
    expect(callsTo('POST', `/classes/${CLASS_ID}/approve-pending`)).toHaveLength(1);
  });

  it('offers nothing when approval is off and nobody is waiting', async () => {
    requireApproval = false;
    rows = [{ ...LIA }];
    openPeople();

    await screen.findByLabelText(switchLabel);
    expect(screen.queryByRole('button', { name: 'Approve all pending' })).toBeNull();
  });

  it('says why an archived class cannot change, and leaves the switch as it was', async () => {
    settingsFailure = failure(409, 'CLASS_ARCHIVED');
    const user = userEvent.setup();
    openPeople();

    await user.click(await screen.findByLabelText(switchLabel));

    expect((await screen.findByRole('alert')).textContent).toContain('This class is archived and read-only.');
    expect((screen.getByLabelText(switchLabel) as HTMLInputElement).checked).toBe(true);
  });
});
