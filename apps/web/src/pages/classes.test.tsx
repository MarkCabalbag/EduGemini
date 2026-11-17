// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassSummary, EnrollmentSummary, Me } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a fake.

const signedInAs = (role: Me['role']): Me => ({
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Cruz',
  role,
  emailVerified: true,
  suspended: false,
});

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

/** A class as a student in it sees it: no join code, link or counts. */
const aStudentClass = (overrides: Partial<ClassSummary> = {}): ClassSummary => ({
  id: crypto.randomUUID(),
  name: 'Biology 101',
  description: null,
  section: null,
  subject: null,
  room: null,
  status: 'ACTIVE',
  instructorName: 'Maria R.',
  enrollment: { status: 'ACTIVE' },
  ...overrides,
});

const anEnrollment = (overrides: Partial<EnrollmentSummary> = {}): EnrollmentSummary => ({
  classId: crypto.randomUUID(),
  className: 'Biology 101',
  status: 'ACTIVE',
  instructorName: 'Maria R.',
  archived: false,
  joinedAt: '2026-11-15T10:00:00.000Z',
  ...overrides,
});

type CreateBody = { name: string; description?: string; section?: string; subject?: string; room?: string };
type UpdateBody = Partial<CreateBody>;
type Call = { path: string; method: string; body?: unknown };

let calls: Call[];
let me: Me;
let classes: ClassSummary[];
let enrolledResult: (cursor: string | null) => Response;
let listResult: (cursor: string | null, status: string | null) => Response;
let getResult: (classId: string) => Response;
let changeResult: (classId: string, action: 'archive' | 'restore') => Response;
let createResult: (body: CreateBody) => Response;
let updateResult: (classId: string, body: UpdateBody) => Response | Promise<Response>;
let joinResult: () => Response;

beforeEach(() => {
  calls = [];
  joinResult = () => failure(404, 'INVALID_JOIN_CODE');
  me = signedInAs('INSTRUCTOR');
  classes = [];
  enrolledResult = () => Response.json({ items: [], nextCursor: null });
  // Like the API: active classes unless archived ones are asked for.
  listResult = (_cursor, status) =>
    Response.json({ items: classes.filter((c) => c.status === (status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE')), nextCursor: null });
  getResult = (classId) => {
    const found = classes.find((c) => c.id === classId);
    return found ? Response.json(found) : failure(404, 'NOT_FOUND');
  };
  changeResult = (classId, action) => {
    const found = classes.find((c) => c.id === classId);
    if (!found) return failure(404, 'NOT_FOUND');
    found.status = action === 'archive' ? 'ARCHIVED' : 'ACTIVE';
    return Response.json(found);
  };
  createResult = (body) => {
    const created = aClass({ name: body.name, section: body.section || null });
    classes.push(created);
    return Response.json(created, { status: 201 });
  };
  // Like the API: a field left out stays, a blank optional one is cleared.
  updateResult = (classId, { name, ...optional }) => {
    const found = classes.find((c) => c.id === classId);
    if (!found) return failure(404, 'NOT_FOUND');
    if (name) found.name = name;
    for (const [key, value] of Object.entries(optional)) Object.assign(found, { [key]: value || null });
    return Response.json(found);
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, method, body });

      if (path === '/me') return Response.json(me);
      if (method === 'POST' && path === '/classes') return createResult(body as CreateBody);
      if (method === 'POST' && path === '/join') return joinResult();
      if (method === 'GET' && (path === '/me/enrollments' || path.startsWith('/me/enrollments?'))) {
        return enrolledResult(new URL(path, 'http://x').searchParams.get('cursor'));
      }
      if (method === 'GET' && (path === '/classes' || path.startsWith('/classes?'))) {
        const { searchParams } = new URL(path, 'http://x');
        return listResult(searchParams.get('cursor'), searchParams.get('status'));
      }
      // The student class page lists the class's assignments; these tests are not about them.
      if (method === 'GET' && /^\/classes\/[^/?]+\/assignments\?/.test(path)) return Response.json({ items: [], nextCursor: null });
      const change = /^\/classes\/([^/?]+)\/(archive|restore)$/.exec(path);
      if (method === 'POST' && change) return changeResult(change[1] ?? '', change[2] as 'archive' | 'restore');
      const one = /^\/classes\/([^/?]+)$/.exec(path);
      if (method === 'GET' && one) return getResult(one[1] ?? '');
      if (method === 'PATCH' && one) return updateResult(one[1] ?? '', body as UpdateBody);
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

describe('instructor dashboard', () => {
  it('invites an instructor with no classes to create one, with a single Create class action', async () => {
    renderAt('/classes');

    expect(await screen.findByText('No classes yet. Create one to share a code with your students.')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Create class' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/classes/new');
  });

  it('shows each class as one card that links to it, with the details that were filled in', async () => {
    classes = [aClass({ name: 'Biology 101', section: 'B', subject: 'Biology', room: '4' }), aClass({ name: 'Essays' })];
    renderAt('/classes');

    const card = await screen.findByRole('link', { name: /Biology 101/ });
    expect(card.getAttribute('href')).toBe(`/classes/${classes[0]?.id}`);
    expect(card.textContent).toContain('Section B · Biology · Room 4');
    expect(screen.getByRole('link', { name: 'Essays' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create class' })).toBeTruthy(); // in the header once there are classes
  });

  it('shows more classes on request, following the cursor', async () => {
    const first = aClass({ name: 'First class' });
    const second = aClass({ name: 'Second class' });
    listResult = (cursor) =>
      cursor === 'next-page'
        ? Response.json({ items: [second], nextCursor: null })
        : Response.json({ items: [first], nextCursor: 'next-page' });
    const user = userEvent.setup();
    renderAt('/classes');

    expect(await screen.findByRole('link', { name: 'First class' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Second class' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show more classes' }));

    expect(await screen.findByRole('link', { name: 'Second class' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'First class' })).toBeTruthy();
    expect(callsTo('GET', '/classes?cursor=next-page')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show more classes' })).toBeNull();
  });

  it('keeps the classes on screen when "Show more" fails, and Retry asks for that page only', async () => {
    const first = aClass({ name: 'First class' });
    const second = aClass({ name: 'Second class' });
    let secondPageWorks = false;
    listResult = (cursor) => {
      if (!cursor) return Response.json({ items: [first], nextCursor: 'next-page' });
      return secondPageWorks ? Response.json({ items: [second], nextCursor: null }) : failure(500, 'INTERNAL');
    };
    const user = userEvent.setup();
    renderAt('/classes');

    await user.click(await screen.findByRole('button', { name: 'Show more classes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    expect(screen.getByRole('link', { name: 'First class' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull(); // that would reload every page

    secondPageWorks = true;
    await user.click(screen.getByRole('button', { name: 'Show more classes' }));

    expect(await screen.findByRole('link', { name: 'Second class' })).toBeTruthy();
    expect(callsTo('GET', '/classes')).toHaveLength(1); // the first page was not asked for again
    expect(callsTo('GET', '/classes?cursor=next-page')).toHaveLength(2);
  });

  it('says what went wrong and lets the instructor try again', async () => {
    listResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt('/classes');

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    classes = [aClass({ name: 'Back again' })];
    listResult = () => Response.json({ items: classes, nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Back again' })).toBeTruthy();
  });

  it('lists archived classes, marked Archived, when "Show archived" is on, and active ones again when it is off', async () => {
    classes = [aClass({ name: 'Current' }), aClass({ name: 'Old class', status: 'ARCHIVED' })];
    const user = userEvent.setup();
    renderAt('/classes');

    expect(await screen.findByRole('link', { name: 'Current' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Old class/ })).toBeNull();

    await user.click(screen.getByLabelText('Show archived'));

    const old = await screen.findByRole('link', { name: /Old class/ });
    expect(old.textContent).toContain('Archived');
    expect(screen.queryByRole('link', { name: 'Current' })).toBeNull();
    expect(callsTo('GET', '/classes?status=ARCHIVED')).toHaveLength(1);

    await user.click(screen.getByLabelText('Show archived'));
    expect(await screen.findByRole('link', { name: 'Current' })).toBeTruthy();
  });

  it('keeps "Show archived" for an instructor whose only class is archived, and says when none are archived', async () => {
    classes = [aClass({ name: 'Old class', status: 'ARCHIVED' })];
    const user = userEvent.setup();
    renderAt('/classes');

    expect(await screen.findByText('No classes yet. Create one to share a code with your students.')).toBeTruthy();
    await user.click(screen.getByLabelText('Show archived'));
    expect(await screen.findByRole('link', { name: /Old class/ })).toBeTruthy();

    classes = [];
    await user.click(screen.getByLabelText('Show archived')); // off, then on again
    await user.click(screen.getByLabelText('Show archived'));
    expect(await screen.findByText('No archived classes.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Create class' })).toHaveLength(1); // the header one; no empty-state prompt
  });

  it('shows a student a welcome and the join box, and never asks for classes', async () => {
    me = signedInAs('STUDENT');
    renderAt('/classes');

    expect(await screen.findByRole('heading', { name: 'Welcome, Maya' })).toBeTruthy();
    expect(screen.getByLabelText('Class code')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/classes'))).toHaveLength(0);
  });

  it('gives an instructor no join box', async () => {
    renderAt('/classes');
    await screen.findByRole('heading', { name: 'My classes' });
    expect(screen.queryByLabelText('Class code')).toBeNull();
  });
});

describe('student joins a class', () => {
  const joinedAs = (status: 'ACTIVE' | 'PENDING' | 'DECLINED') => Response.json({ classId: crypto.randomUUID(), className: 'Biology 101', status });

  beforeEach(() => {
    me = signedInAs('STUDENT');
  });

  it('sends the code in capitals, trimmed, and says the student joined', async () => {
    joinResult = () => joinedAs('ACTIVE');
    const user = userEvent.setup();
    renderAt('/classes');

    await user.type(await screen.findByLabelText('Class code'), '  k7m2pq9x ');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('status')).textContent).toContain('You joined Biology 101.');
    expect(callsTo('POST', '/join')[0]?.body).toEqual({ code: 'K7M2PQ9X' });
    expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe(''); // ready for another code
  });

  it('says Pending approval when the class needs the instructor to approve', async () => {
    joinResult = () => joinedAs('PENDING');
    const user = userEvent.setup();
    renderAt('/classes');

    await user.type(await screen.findByLabelText('Class code'), 'K7M2PQ9X');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('status')).textContent).toContain('Pending approval. Your instructor will review your request.');
  });

  it('says so when the student was declined earlier', async () => {
    joinResult = () => joinedAs('DECLINED');
    const user = userEvent.setup();
    renderAt('/classes');

    await user.type(await screen.findByLabelText('Class code'), 'K7M2PQ9X');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('status')).textContent).toContain('Your request to join Biology 101 was declined.');
  });

  it('asks for an 8-character code and sends nothing when the code is the wrong length', async () => {
    const user = userEvent.setup();
    renderAt('/classes');

    await user.type(await screen.findByLabelText('Class code'), 'ABC');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect(await screen.findByText('Enter the 8-character code')).toBeTruthy();
    expect(callsTo('POST', '/join')).toHaveLength(0);
  });

  it.each([
    ['INVALID_JOIN_CODE', 404, "That code didn't work. Check it and try again."],
    ['JOIN_BLOCKED', 403, "You can't join this class right now. Contact the instructor."],
    ['RATE_LIMITED', 429, 'Too many attempts. Try again in a few minutes.'],
  ] as const)('shows %s above the form and keeps the code for another try', async (code, status, text) => {
    joinResult = () => failure(status, code);
    const user = userEvent.setup();
    renderAt('/classes');

    await user.type(await screen.findByLabelText('Class code'), 'K7M2PQ9X');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
  });

  it('drops the old message when the student tries again', async () => {
    joinResult = () => failure(404, 'INVALID_JOIN_CODE');
    const user = userEvent.setup();
    renderAt('/classes');
    await user.type(await screen.findByLabelText('Class code'), 'K7M2PQ9X');
    await user.click(screen.getByRole('button', { name: 'Join class' }));
    await screen.findByRole('alert');

    joinResult = () => joinedAs('ACTIVE');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('student Enrolled list', () => {
  beforeEach(() => {
    me = signedInAs('STUDENT');
  });

  it('shows each class with its status, and only an approved class is a link', async () => {
    const approved = anEnrollment({ className: 'Biology 101' });
    enrolledResult = () =>
      Response.json({
        items: [
          approved,
          anEnrollment({ className: 'Chemistry', status: 'PENDING' }),
          anEnrollment({ className: 'Physics', status: 'DECLINED' }),
          anEnrollment({ className: 'History', archived: true }),
        ],
        nextCursor: null,
      });
    renderAt('/classes');

    const link = await screen.findByRole('link', { name: /Biology 101/ });
    expect(link.getAttribute('href')).toBe(`/classes/${approved.classId}`);
    expect(link.textContent).toContain('Taught by Maria R.');
    expect(link.textContent).toContain('Approved');
    expect(screen.getByRole('link', { name: /History/ }).textContent).toContain('Archived'); // read-only, but still opens

    // Pending and declined show their words and are not links.
    expect(screen.getByText('Pending approval')).toBeTruthy();
    expect(screen.getByText('Your instructor will review your request.')).toBeTruthy();
    expect(screen.getByText('Declined')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Chemistry/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Physics/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Chemistry' })).toBeTruthy();
  });

  it('says so when the student has not joined a class', async () => {
    renderAt('/classes');

    expect(await screen.findByText("You haven't joined a class yet. Enter a class code above to join one.")).toBeTruthy();
  });

  it('shows more classes on request, following the cursor', async () => {
    enrolledResult = (cursor) =>
      cursor === 'next-page'
        ? Response.json({ items: [anEnrollment({ className: 'Second class' })], nextCursor: null })
        : Response.json({ items: [anEnrollment({ className: 'First class' })], nextCursor: 'next-page' });
    const user = userEvent.setup();
    renderAt('/classes');

    expect(await screen.findByRole('link', { name: /First class/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show more classes' }));

    expect(await screen.findByRole('link', { name: /Second class/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /First class/ })).toBeTruthy();
    expect(callsTo('GET', '/me/enrollments?cursor=next-page')).toHaveLength(1);
  });

  it('adds a class to the list as soon as the student joins it', async () => {
    const joined = anEnrollment({ className: 'Just joined', status: 'PENDING' });
    let items: EnrollmentSummary[] = [];
    enrolledResult = () => Response.json({ items, nextCursor: null });
    joinResult = () => {
      items = [joined];
      return Response.json({ classId: joined.classId, className: joined.className, status: 'PENDING' }, { status: 201 });
    };
    const user = userEvent.setup();
    renderAt('/classes');

    await screen.findByText("You haven't joined a class yet. Enter a class code above to join one.");
    await user.type(screen.getByLabelText('Class code'), 'K7M2PQ9X');
    await user.click(screen.getByRole('button', { name: 'Join class' }));

    expect(await screen.findByRole('heading', { name: 'Just joined' })).toBeTruthy();
    expect(screen.getByText('Pending approval')).toBeTruthy();
  });

  it('says what went wrong and lets the student try again', async () => {
    enrolledResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt('/classes');

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    enrolledResult = () => Response.json({ items: [anEnrollment({ className: 'Back again' })], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: /Back again/ })).toBeTruthy();
  });

  it('is never asked for by an instructor', async () => {
    me = signedInAs('INSTRUCTOR');
    renderAt('/classes');

    await screen.findByRole('heading', { name: 'My classes' });
    expect(calls.filter((c) => c.path.startsWith('/me/enrollments'))).toHaveLength(0);
  });
});

describe('class page, as a student', () => {
  beforeEach(() => {
    me = signedInAs('STUDENT');
  });

  it('shows the details and the instructor name, and no class code', async () => {
    const cls = aStudentClass({ name: 'Physics', description: 'Forces and motion', section: 'A', subject: 'Science', room: '12' });
    getResult = () => Response.json(cls);
    renderAt(`/classes/${cls.id}`);

    expect(await screen.findByRole('heading', { name: 'Physics' })).toBeTruthy();
    expect(screen.getByText('Taught by Maria R.')).toBeTruthy();
    expect(screen.getByText('Section A · Science · Room 12')).toBeTruthy();
    expect(screen.getByText('Forces and motion')).toBeTruthy();
    expect(screen.queryByLabelText('Class code')).toBeNull();
    expect(screen.queryByRole('link', { name: 'People' })).toBeNull(); // the instructor's sections
    expect(screen.getByRole('link', { name: 'My classes' }).getAttribute('href')).toBe('/classes');
  });

  it('marks an archived class', async () => {
    const cls = aStudentClass({ status: 'ARCHIVED' });
    getResult = () => Response.json(cls);
    renderAt(`/classes/${cls.id}`);

    await screen.findByRole('heading', { name: 'Biology 101' });
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('shows a pending student only the class name and "Pending approval"', async () => {
    getResult = () => failure(403, 'ENROLLMENT_PENDING', undefined, { className: 'Secret club' });
    renderAt(`/classes/${crypto.randomUUID()}`);

    expect(await screen.findByRole('heading', { name: 'Secret club' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain('Pending approval. Your instructor will review your request.');
    expect(screen.queryByText(/Taught by/)).toBeNull();
  });

  it('is not found for a class the student is declined from, removed from, or not in', async () => {
    renderAt(`/classes/${crypto.randomUUID()}`); // the API answers 404 for all three

    expect(await screen.findByRole('heading', { name: /couldn.t find that page/i })).toBeTruthy();
  });

  it('says what went wrong and lets the student try again', async () => {
    const cls = aStudentClass({ name: 'Chemistry' });
    getResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    getResult = () => Response.json(cls);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Chemistry' })).toBeTruthy();
  });
});

describe('create class', () => {
  it('shows the attestation in full and keeps Create class disabled until it is ticked', async () => {
    const user = userEvent.setup();
    renderAt('/classes/new');

    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Create class' });
    expect(screen.getByText(/I have the authority to collect and upload my students' work/)).toBeTruthy();
    expect(button.disabled).toBe(true);

    await user.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
    await user.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(true);
  });

  it('says why the button is off, and stops saying it once the attestation is ticked', async () => {
    const user = userEvent.setup();
    renderAt('/classes/new');

    const button = await screen.findByRole('button', { name: 'Create class' });
    const hint = screen.getByText('Confirm the statement above to create the class.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);

    await user.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('Confirm the statement above to create the class.')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('sends the details and the attestation, then opens the new class with its code and link', async () => {
    const user = userEvent.setup();
    renderAt('/classes/new');

    await user.type(await screen.findByLabelText('Class name'), 'Biology 101');
    await user.type(screen.getByLabelText('Section (optional)'), 'B');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findByRole('heading', { name: 'Biology 101' })).toBeTruthy();
    expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    expect((screen.getByLabelText('Join link') as HTMLInputElement).value).toBe('http://localhost:5173/join/K7M2PQ9X');
    expect(callsTo('POST', '/classes')[0]?.body).toMatchObject({
      name: 'Biology 101',
      section: 'B',
      attestation: { confirmed: true },
    });
  });

  it('names a missing class name and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt('/classes/new');

    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findByText('Required')).toBeTruthy();
    expect(callsTo('POST', '/classes')).toHaveLength(0);
  });

  it('puts a problem the server found under its field and stays on the form', async () => {
    createResult = () => failure(400, 'VALIDATION', { name: 'That name is not allowed' });
    const user = userEvent.setup();
    renderAt('/classes/new');

    await user.type(await screen.findByLabelText('Class name'), 'Biology 101');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findByText('That name is not allowed')).toBeTruthy();
    expect(screen.getByLabelText('Class name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Create class' })).toBeTruthy();
  });

  it('shows the rate limit above the form', async () => {
    createResult = () => failure(429, 'RATE_LIMITED');
    const user = userEvent.setup();
    renderAt('/classes/new');

    await user.type(await screen.findByLabelText('Class name'), 'Biology 101');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts');
  });

  it('shows a student the no-access page, with no form and nothing sent', async () => {
    me = signedInAs('STUDENT');
    renderAt('/classes/new');

    expect(await screen.findByRole('heading', { name: /you don.t have access to this page/i })).toBeTruthy();
    expect(screen.queryByLabelText('Class name')).toBeNull();
  });
});

describe('class page', () => {
  it('shows the details, the class code and the join link', async () => {
    const cls = aClass({ name: 'Physics', description: 'Forces and motion', section: 'A', subject: 'Science', room: '12' });
    classes = [cls];
    renderAt(`/classes/${cls.id}`);

    expect(await screen.findByRole('heading', { name: 'Physics' })).toBeTruthy();
    expect(screen.getByText('Section A · Science · Room 12')).toBeTruthy();
    expect(screen.getByText('Forces and motion')).toBeTruthy();
    expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    expect(screen.getByRole('link', { name: 'My classes' }).getAttribute('href')).toBe('/classes');
  });

  it('copies the code and the link, and says so', async () => {
    const cls = aClass();
    classes = [cls];
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Copy class code' }));
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe('K7M2PQ9X');

    await user.click(screen.getByRole('button', { name: 'Copy join link' }));
    expect(await navigator.clipboard.readText()).toBe('http://localhost:5173/join/K7M2PQ9X');
  });

  it('announces a second press of Copy again, as a new message', async () => {
    const cls = aClass();
    classes = [cls];
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Copy class code' }));
    const first = await screen.findByText('Copied');
    await user.click(screen.getByRole('button', { name: 'Copy class code' }));

    const second = await screen.findByText('Copied');
    expect(second).not.toBe(first); // a new element is what a screen reader announces
    expect(first.isConnected).toBe(false);
  });

  it('tells the user when the browser would not copy', async () => {
    const cls = aClass();
    classes = [cls];
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'));
    renderAt(`/classes/${cls.id}`);

    await user.click(await screen.findByRole('button', { name: 'Copy class code' }));

    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  it('is not found for a class the API does not show, whoever asks', async () => {
    renderAt(`/classes/${crypto.randomUUID()}`);
    expect(await screen.findByRole('heading', { name: /couldn.t find that page/i })).toBeTruthy();
  });

  it('is not found for an address that is not a class id, not a Retry screen', async () => {
    getResult = () => failure(400, 'VALIDATION', { 'params.classId': 'Invalid UUID' });
    renderAt('/classes/abc');

    expect(await screen.findByRole('heading', { name: /couldn.t find that page/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  describe('archive and restore', () => {
    const archiveCalls = (cls: ClassSummary) => callsTo('POST', `/classes/${cls.id}/archive`);

    it('asks first, then archives: the page shows the Archived chip, offers Restore, and no longer offers the code', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      await user.click(await screen.findByRole('button', { name: 'Archive class' }));
      expect(archiveCalls(cls)).toHaveLength(0); // it asked, and has not archived yet
      const dialog = screen.getByRole('dialog', { name: 'Archive Physics?' });
      await user.click(within(dialog).getByRole('button', { name: 'Archive class' }));

      expect(await screen.findByRole('button', { name: 'Restore class' })).toBeTruthy();
      expect(archiveCalls(cls)).toHaveLength(1);
      expect(screen.getByText('Archived')).toBeTruthy();
      expect(screen.queryByLabelText('Class code')).toBeNull(); // an archived class's code does not work
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('archives nothing when the instructor cancels', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      await user.click(await screen.findByRole('button', { name: 'Archive class' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(archiveCalls(cls)).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Archive class' })).toBeTruthy();
    });

    it('restores an archived class without asking, and the code comes back', async () => {
      const cls = aClass({ name: 'Physics', status: 'ARCHIVED' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      expect(await screen.findByText('Archived')).toBeTruthy();
      expect(screen.queryByLabelText('Class code')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Restore class' }));

      expect(await screen.findByRole('button', { name: 'Archive class' })).toBeTruthy();
      expect(callsTo('POST', `/classes/${cls.id}/restore`)).toHaveLength(1);
      expect(screen.queryByText('Archived')).toBeNull();
      expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    });

    it('says what went wrong when archiving fails, and the class stays as it was', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      changeResult = () => failure(500, 'INTERNAL');
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      await user.click(await screen.findByRole('button', { name: 'Archive class' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive class' }));

      expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Archive class' })).toBeTruthy();
    });
  });

  describe('edit class details', () => {
    const editCalls = (cls: ClassSummary) => callsTo('PATCH', `/classes/${cls.id}`);
    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole('button', { name: 'Edit class details' }));
      return screen.getByRole('dialog', { name: 'Edit class details' });
    };

    it('opens with the saved details, saves a change and a cleared field, and shows the new details with the code unchanged', async () => {
      const cls = aClass({ name: 'Physics', description: 'Forces', section: 'A', subject: 'Science', room: '12' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      expect((within(dialog).getByLabelText('Class name') as HTMLInputElement).value).toBe('Physics');
      expect((within(dialog).getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe('Forces');
      expect((within(dialog).getByLabelText('Section (optional)') as HTMLInputElement).value).toBe('A');
      await user.clear(within(dialog).getByLabelText('Class name'));
      await user.type(within(dialog).getByLabelText('Class name'), 'Physics 2');
      await user.clear(within(dialog).getByLabelText('Section (optional)'));
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(editCalls(cls)).toMatchObject([{ body: { name: 'Physics 2', description: 'Forces', section: '', subject: 'Science', room: '12' } }]);
      expect(screen.getByRole('heading', { name: 'Physics 2' })).toBeTruthy();
      expect(screen.getByText('Science · Room 12')).toBeTruthy(); // the section is gone
      expect((screen.getByLabelText('Class code') as HTMLInputElement).value).toBe('K7M2PQ9X');
    });

    it('changes nothing on Cancel, and opens again with the saved details, not the unsaved ones', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      await user.type(within(dialog).getByLabelText('Class name'), ' (draft)');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(editCalls(cls)).toHaveLength(0);
      expect(screen.getByRole('heading', { name: 'Physics' })).toBeTruthy();
      expect((within(await openDialog(user)).getByLabelText('Class name') as HTMLInputElement).value).toBe('Physics');
    });

    it('names a blank class name and sends nothing', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      await user.clear(within(dialog).getByLabelText('Class name'));
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await within(dialog).findByText('Required')).toBeTruthy();
      expect(editCalls(cls)).toHaveLength(0);
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('puts a problem the server found under its field, and keeps what was typed', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      updateResult = () => failure(400, 'VALIDATION', { room: 'Too long' });
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      await user.type(within(dialog).getByLabelText('Room (optional)'), '12');
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await within(dialog).findByText('Too long')).toBeTruthy();
      expect((within(dialog).getByLabelText('Room (optional)') as HTMLInputElement).value).toBe('12');
    });

    it('says what went wrong inside the dialog, and the class stays as it was', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      updateResult = () => failure(409, 'CLASS_ARCHIVED');
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      await user.type(within(dialog).getByLabelText('Class name'), ' 2');
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect((await within(dialog).findByRole('alert')).textContent).toContain('This class is archived and read-only.');
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Physics', hidden: true })).toBeTruthy(); // the page behind the dialog is hidden from screen readers
    });

    it('stays open while the save runs, so Escape cannot close it and lose the answer', async () => {
      const cls = aClass({ name: 'Physics' });
      classes = [cls];
      let answer: (response: Response) => void = () => {};
      updateResult = () => new Promise((resolve) => (answer = resolve));
      const user = userEvent.setup();
      renderAt(`/classes/${cls.id}`);

      const dialog = await openDialog(user);
      await user.type(within(dialog).getByLabelText('Class name'), ' 2');
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(editCalls(cls)).toHaveLength(1));
      await user.keyboard('{Escape}');

      expect(screen.getByRole('dialog')).toBeTruthy();
      expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
      answer(failure(409, 'CLASS_ARCHIVED'));
      expect((await within(dialog).findByRole('alert')).textContent).toContain('This class is archived and read-only.');
    });

    it('is not offered on an archived class, which is read-only', async () => {
      const cls = aClass({ name: 'Physics', status: 'ARCHIVED' });
      classes = [cls];
      renderAt(`/classes/${cls.id}`);

      expect(await screen.findByRole('button', { name: 'Restore class' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit class details' })).toBeNull();
    });
  });

  it('says what went wrong and lets the user try again', async () => {
    const cls = aClass({ name: 'Chemistry' });
    classes = [cls];
    getResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt(`/classes/${cls.id}`);

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    getResult = () => Response.json(cls);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Chemistry' })).toBeTruthy();
  });
});
