// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentDetail, ClassSummary, Me, PublishWarning, ReferenceFileView, UpdateAssignment } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserTimeZone } from '../lib/zoned-time';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a small in-memory fake.

const signedInAs = (role: Me['role']): Me => ({
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Cruz',
  role,
  emailVerified: true,
  suspended: false,
});

const CLASS_ID = '9b1d6a52-1c0e-4e57-8d5c-0d3f4a9f7b22';

const aClass = (overrides: Partial<ClassSummary> = {}): ClassSummary => ({
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
  requireApproval: false,
  ...overrides,
});

/** A class as an approved student in it sees it: no join code, link or counts. */
const aStudentClass = (overrides: Partial<ClassSummary> = {}): ClassSummary => ({
  id: CLASS_ID,
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

const anAssignment = (overrides: Partial<AssignmentDetail> = {}): AssignmentDetail => ({
  id: crypto.randomUUID(),
  classId: CLASS_ID,
  title: 'Essay 2',
  instructions: null,
  criteriaText: '',
  dueAt: '2026-12-01T15:59:00.000Z',
  timezone: 'Asia/Manila',
  status: 'DRAFT',
  scoringFormat: 'POINTS',
  maxScore: 100,
  maxResubmissions: 3,
  acceptLate: true,
  criteriaVersion: 1,
  referenceFiles: [],
  ...overrides,
});

type Call = { path: string; method: string; body?: unknown };

let calls: Call[];
let me: Me;
let cls: ClassSummary;
let assignments: AssignmentDetail[];
let pageSize: number;
let denied: (() => Response) | undefined; // makes one assignment read fail
let publishResult: (assignment: AssignmentDetail) => Response;
let refuseSave: (() => Response) | undefined; // makes a save (PATCH) fail
let refuseReference: (() => Response) | undefined; // makes adding a reference file fail

beforeEach(() => {
  calls = [];
  refuseReference = undefined;
  me = signedInAs('INSTRUCTOR');
  cls = aClass();
  assignments = [];
  pageSize = 100;
  denied = undefined;
  refuseSave = undefined;
  publishResult = (assignment) => {
    assignment.status = 'PUBLISHED';
    return Response.json({ ...assignment, warnings: [] satisfies PublishWarning[] });
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body; // a form (FormData) is kept as it is
      calls.push({ path, method, body });

      if (path === '/me') return Response.json(me);
      if (method === 'GET' && path === `/classes/${cls.id}`) return Response.json(cls);

      // Reference files (API Spec REF-01 to REF-04): the file lives in its assignment's list, as the API's reads show it.
      const addFile = /^\/assignments\/([^/?]+)\/reference-files$/.exec(path);
      if (method === 'POST' && addFile) {
        const target = assignments.find((a) => a.id === addFile[1]);
        if (!target) return failure(404, 'NOT_FOUND');
        if (refuseReference) return refuseReference();
        const sent = (body as FormData).get('file') as File;
        const ordinal = [1, 2, 3].find((n) => !target.referenceFiles.some((f) => f.ordinal === n));
        if (!ordinal) return failure(422, 'FILE_LIMIT', undefined, { limit: 'reference-count' });
        const created = {
          id: crypto.randomUUID(),
          ordinal,
          label: `Reference file ${ordinal}`,
          mimeType: sent.type,
          sizeBytes: sent.size,
          visibleToStudents: false,
        };
        target.referenceFiles.push(created);
        return Response.json(created, { status: 201 });
      }
      const fileRoute = /^\/reference-files\/([^/?]+)(\/url)?$/.exec(path);
      if (fileRoute) {
        const holder = assignments.find((a) => a.referenceFiles.some((f) => f.id === fileRoute[1]));
        const file = holder?.referenceFiles.find((f) => f.id === fileRoute[1]);
        if (!holder || !file) return failure(404, 'NOT_FOUND');
        if (method === 'GET' && fileRoute[2])
          return Response.json({ url: `https://files.example/${file.id}`, expiresAt: '2026-12-01T00:05:00.000Z' });
        if (method === 'PATCH') {
          file.visibleToStudents = (body as { visibleToStudents: boolean }).visibleToStudents;
          return Response.json(file);
        }
        if (method === 'DELETE') {
          holder.referenceFiles = holder.referenceFiles.filter((f) => f !== file);
          return new Response(null, { status: 204 });
        }
      }

      const list = /^\/classes\/[^/?]+\/assignments\?(.*)$/.exec(path);
      if (method === 'GET' && list) {
        // Like the API: one status, a page at a time. The cursor here is just the position of the next item.
        const query = new URLSearchParams(list[1]);
        const all = assignments.filter((a) => a.status === query.get('status'));
        const start = Number(query.get('cursor') ?? 0);
        const next = start + pageSize;
        return Response.json({ items: all.slice(start, next), nextCursor: next < all.length ? String(next) : null });
      }
      if (method === 'POST' && /^\/classes\/[^/?]+\/assignments$/.test(path)) {
        const input = body as Partial<AssignmentDetail> & { title: string };
        const created = anAssignment({ title: input.title, instructions: input.instructions || null, timezone: input.timezone ?? 'UTC' });
        assignments.push(created);
        return Response.json(created, { status: 201 });
      }

      const one = /^\/assignments\/([^/?]+)(\/publish)?$/.exec(path);
      const found = assignments.find((a) => a.id === one?.[1]);
      if (method === 'GET' && denied) return denied();
      if (!one) return failure(404, 'NOT_FOUND');
      if (!found) return failure(404, 'NOT_FOUND');
      if (method === 'GET') return Response.json(found);
      if (method === 'POST' && one[2]) return publishResult(found);
      if (method === 'PATCH') {
        if (refuseSave) return refuseSave();
        Object.assign(found, body as UpdateAssignment);
        return Response.json(found);
      }
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const callsTo = (method: string, pathStart: string) => calls.filter((c) => c.method === method && c.path.startsWith(pathStart));
const bodyOf = (call: Call | undefined) => call?.body;

describe('the Assignments tab', () => {
  const open = () => renderAt(`/classes/${CLASS_ID}?tab=assignments`);

  it('invites the instructor to create a first assignment, with a single New assignment action', async () => {
    open();

    expect(await screen.findByText('Create your first assignment.')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'New assignment' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(`/classes/${CLASS_ID}/assignments/new`);
  });

  it('lists drafts above published assignments, each with when it is due and how it is scored', async () => {
    assignments = [
      anAssignment({ title: 'Lab report', maxScore: 50, maxResubmissions: null }),
      anAssignment({ title: 'Essay 2', status: 'PUBLISHED', scoringFormat: 'PERCENTAGE', maxResubmissions: 0 }),
    ];
    open();

    const draft = (await screen.findByText('Lab report')).closest('li')!;
    expect(within(draft).getByText('Draft')).toBeTruthy();
    expect(draft.textContent).toContain('Due Dec 1, 2026');
    expect(draft.textContent).toContain('(Asia/Manila)');
    expect(draft.textContent).toContain('50 points · Unlimited resubmissions');
    expect(within(draft).getByRole('link', { name: 'Resume Lab report' }).getAttribute('href')).toBe(
      `/assignments/${assignments[0]?.id}/edit`,
    );

    const published = screen.getByText('Essay 2').closest('li')!;
    expect(published.textContent).toContain('Percentage · No resubmissions');
    expect(within(published).queryByText('Draft')).toBeNull();
    expect(within(published).queryByRole('link', { name: /Resume/ })).toBeNull();
    expect(within(published).getByRole('link', { name: 'Edit Essay 2' }).getAttribute('href')).toBe(
      `/assignments/${assignments[1]?.id}/edit`,
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Drafts', 'Published']);
    expect(screen.getByRole('link', { name: 'New assignment' })).toBeTruthy(); // in the header once there are assignments
  });

  it('is read-only for an archived class: nothing to create, resume or edit', async () => {
    cls = aClass({ status: 'ARCHIVED' });
    assignments = [anAssignment({ title: 'Lab report' }), anAssignment({ title: 'Essay 2', status: 'PUBLISHED' })];
    open();

    expect(await screen.findByText('Lab report')).toBeTruthy();
    expect(await screen.findByText('Essay 2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New assignment' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Resume|Edit/ })).toBeNull();
  });

  it('says there are none for an archived class with no assignments', async () => {
    cls = aClass({ status: 'ARCHIVED' });
    open();

    expect(await screen.findByText('No assignments.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New assignment' })).toBeNull();
  });

  it('is a section of the class page, next to Overview and People', async () => {
    open();

    const nav = await screen.findByRole('navigation', { name: 'Class sections' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'Assignments', 'People']);
    expect(within(nav).getByRole('link', { name: 'Assignments' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('the assignment wizard', () => {
  it('makes the draft after step 1, in this browser’s time zone, and moves on saying so', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}/assignments/new`);

    expect(await screen.findByText('Step 1 of 5: Basics')).toBeTruthy();
    await user.type(screen.getByLabelText('Title'), 'Essay 2');
    await user.type(screen.getByLabelText('Instructions (optional)'), 'Write 500 words.');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Step 2 of 5: Criteria')).toBeTruthy();
    expect(screen.getByText('Draft saved')).toBeTruthy();
    expect(bodyOf(callsTo('POST', `/classes/${CLASS_ID}/assignments`)[0])).toEqual({
      title: 'Essay 2',
      instructions: 'Write 500 words.',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('needs a title before it makes anything', async () => {
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}/assignments/new`);

    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Required')).toBeTruthy();
    expect(callsTo('POST', '/classes')).toHaveLength(0);
  });

  it('is not for a student, who gets the no-access page', async () => {
    me = signedInAs('STUDENT');
    renderAt(`/classes/${CLASS_ID}/assignments/new`);

    expect(await screen.findByRole('heading', { name: /you don.t have access to this page/i })).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('keeps a student out of the edit address too', async () => {
    me = signedInAs('STUDENT');
    renderAt(`/assignments/${crypto.randomUUID()}/edit`);

    expect(await screen.findByRole('heading', { name: /you don.t have access to this page/i })).toBeTruthy();
  });

  it('saves the criteria, and asks for them first', async () => {
    const draft = anAssignment();
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=2`);

    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Add grading criteria')).toBeTruthy();
    expect(callsTo('PATCH', `/assignments/${draft.id}`)).toHaveLength(0);

    await user.type(screen.getByLabelText('Grading criteria'), 'Thesis is clear (10 points).');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Step 3 of 5: Due date and scoring')).toBeTruthy();
    expect(bodyOf(callsTo('PATCH', `/assignments/${draft.id}`)[0])).toEqual({ criteriaText: 'Thesis is clear (10 points).' });
  });

  it('saves the due date on the clock of the chosen zone, and the scoring', async () => {
    const draft = anAssignment({ timezone: 'UTC' });
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=3`);

    fireEvent.change(await screen.findByLabelText('Due date and time'), { target: { value: '2026-12-01T23:59' } });
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Manila');
    await user.clear(screen.getByLabelText('Max score'));
    await user.type(screen.getByLabelText('Max score'), '50');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Step 4 of 5: Rules')).toBeTruthy();
    expect(bodyOf(callsTo('PATCH', `/assignments/${draft.id}`)[0])).toEqual({
      dueAt: '2026-12-01T15:59:00.000Z', // 23:59 in Manila is UTC+8
      timezone: 'Asia/Manila',
      scoringFormat: 'POINTS',
      maxScore: 50,
    });
  });

  it('scores a percentage assignment out of 100, with no max score to type', async () => {
    const draft = anAssignment();
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=3`);

    await user.selectOptions(await screen.findByLabelText('Scoring format'), 'PERCENTAGE');

    expect(screen.queryByLabelText('Max score')).toBeNull();
    expect(screen.getByText('Scored out of 100.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Step 4 of 5: Rules');
    expect(bodyOf(callsTo('PATCH', `/assignments/${draft.id}`)[0])).toMatchObject({ scoringFormat: 'PERCENTAGE' });
    expect(bodyOf(callsTo('PATCH', `/assignments/${draft.id}`)[0])).not.toHaveProperty('maxScore');
  });

  it.each([
    ['a max score of 0', '0'],
    ['a max score over 1000', '1001'],
  ])('refuses %s and saves nothing', async (_label, value) => {
    const draft = anAssignment();
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=3`);

    await user.clear(await screen.findByLabelText('Max score'));
    await user.type(screen.getByLabelText('Max score'), value);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Use a number from 0.01 to 1000')).toBeTruthy();
    expect(callsTo('PATCH', `/assignments/${draft.id}`)).toHaveLength(0);
  });

  it('saves the resubmission limit (Unlimited is null) and the late policy', async () => {
    const draft = anAssignment();
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=4`);

    await user.selectOptions(await screen.findByLabelText('Resubmissions allowed after the first submission'), 'Unlimited');
    await user.click(screen.getByLabelText('Accept late submissions'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Step 5 of 5: Review')).toBeTruthy();
    expect(bodyOf(callsTo('PATCH', `/assignments/${draft.id}`)[0])).toEqual({ maxResubmissions: null, acceptLate: false });
  });

  it('goes back a step without saving', async () => {
    const draft = anAssignment();
    assignments = [draft];
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=4`);

    await user.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByText('Step 3 of 5: Due date and scoring')).toBeTruthy();
    expect(callsTo('PATCH', '/assignments')).toHaveLength(0);
  });

  it('reviews everything, then publishes and goes back to the list with a notice and the warnings', async () => {
    const draft = anAssignment({
      criteriaText: 'Thesis is clear (10 points).',
      instructions: 'Write 500 words.',
      maxScore: 50,
      maxResubmissions: null,
      acceptLate: false,
    });
    assignments = [draft];
    publishResult = (assignment) => {
      assignment.status = 'PUBLISHED';
      return Response.json({ ...assignment, warnings: ['DUE_IN_PAST', 'NO_VALID_KEY'] });
    };
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=5`);

    const summary = (await screen.findByText('Grading criteria')).closest('dl')!;
    expect(summary.textContent).toContain('Essay 2');
    expect(summary.textContent).toContain('Write 500 words.');
    expect(summary.textContent).toContain('Thesis is clear (10 points).');
    expect(summary.textContent).toContain('(Asia/Manila)');
    expect(summary.textContent).toContain('50 points');
    expect(summary.textContent).toContain('Unlimited resubmissions');
    expect(summary.textContent).toContain('Not accepted');

    await user.click(screen.getByRole('button', { name: 'Publish assignment' }));

    expect(await screen.findByText('Essay 2 is published. Approved students can see it now.')).toBeTruthy();
    expect(screen.getByText('The due date has already passed, so every submission will be marked Late.')).toBeTruthy();
    expect(screen.getByText(/No Gemini key is connected/)).toBeTruthy();
    expect(callsTo('POST', `/assignments/${draft.id}/publish`)).toHaveLength(1);
    // Back on the Assignments tab, the assignment is now under Published.
    expect(await screen.findByRole('heading', { level: 3, name: 'Published' })).toBeTruthy();
  });

  it('keeps the draft and says why when publishing is refused', async () => {
    const draft = anAssignment();
    assignments = [draft];
    publishResult = () => failure(400, 'VALIDATION', { criteriaText: 'Add grading criteria before publishing' });
    const user = userEvent.setup();
    renderAt(`/assignments/${draft.id}/edit?step=5`);

    expect(await screen.findByText('Not added yet. Add grading criteria before publishing.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Publish assignment' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Add grading criteria before publishing');
    expect(screen.getByText('Step 5 of 5: Review')).toBeTruthy(); // still here
  });

  it('only leaves, when "Save as draft" is pressed, since the draft is already saved', async () => {
    const draft = anAssignment({ criteriaText: 'Thesis is clear.' });
    assignments = [draft];
    renderAt(`/assignments/${draft.id}/edit?step=5`);

    const link = await screen.findByRole('link', { name: 'Save as draft' });

    expect(link.getAttribute('href')).toBe(`/classes/${CLASS_ID}?tab=assignments`);
    expect(callsTo('PATCH', '/assignments')).toHaveLength(0);
  });

  it('says an archived assignment cannot be edited, with no form', async () => {
    const archived = anAssignment({ status: 'ARCHIVED' });
    assignments = [archived];
    renderAt(`/assignments/${archived.id}/edit`);

    expect(await screen.findByText(/archived and cannot be edited/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue|Save changes/ })).toBeNull();
  });

  it('shows the same page as a missing one for an assignment that is not found', async () => {
    renderAt(`/assignments/${crypto.randomUUID()}/edit`);

    expect(await screen.findByText(/couldn.t find that page/i)).toBeTruthy();
  });
});

describe('editing a published assignment', () => {
  const published = () => anAssignment({ status: 'PUBLISHED', criteriaText: 'Thesis is clear (10 points).', timezone: 'Asia/Manila' });
  const section = (name: string) => within(screen.getByRole('region', { name }));
  const patches = (id: string) => callsTo('PATCH', `/assignments/${id}`);

  it('shows the title, the instructions, the due date and scoring, and the rules, each with its own Save changes, and no criteria', async () => {
    const assignment = published();
    assignments = [assignment];
    renderAt(`/assignments/${assignment.id}/edit`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Essay 2' })).toBeTruthy();
    expect(screen.getByText(/published, so changes apply right away/)).toBeTruthy();
    expect(screen.getByText(/criteria cannot be changed yet/)).toBeTruthy();
    expect(screen.getAllByRole('region').map((r) => r.querySelector('h2')?.textContent)).toEqual([
      'Basics',
      'Due date and scoring',
      'Reference files (optional, up to 3)',
      'Rules',
    ]);
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByLabelText('Grading criteria')).toBeNull();
    expect(screen.getByRole('link', { name: 'Assignments' }).getAttribute('href')).toBe(`/classes/${CLASS_ID}?tab=assignments`);
  });

  it('saves a new due date on the clock of its zone, sends no criteria, and says what was saved', async () => {
    const assignment = published();
    assignments = [assignment];
    const user = userEvent.setup();
    renderAt(`/assignments/${assignment.id}/edit`);

    fireEvent.change(await screen.findByLabelText('Due date and time'), { target: { value: '2026-12-08T23:59' } });
    await user.click(section('Due date and scoring').getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Due date and scoring saved.')).toBeTruthy();
    expect(bodyOf(patches(assignment.id)[0])).toEqual({
      dueAt: '2026-12-08T15:59:00.000Z', // 23:59 in Manila is UTC+8
      timezone: 'Asia/Manila',
      scoringFormat: 'POINTS',
      maxScore: 100,
    });
  });

  it('saves the title and shows the new one at the top', async () => {
    const assignment = published();
    assignments = [assignment];
    const user = userEvent.setup();
    renderAt(`/assignments/${assignment.id}/edit`);

    await user.clear(await screen.findByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Essay 3');
    await user.click(section('Basics').getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Essay 3' })).toBeTruthy();
    expect(screen.getByText('Basics saved.')).toBeTruthy();
    expect(bodyOf(patches(assignment.id)[0])).toMatchObject({ title: 'Essay 3' });
  });

  it('saves the rules, and shows only the newest "saved"', async () => {
    const assignment = published();
    assignments = [assignment];
    const user = userEvent.setup();
    renderAt(`/assignments/${assignment.id}/edit`);

    await screen.findByRole('heading', { level: 1, name: 'Essay 2' });
    await user.click(section('Basics').getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Basics saved.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Resubmissions allowed after the first submission'), '1');
    await user.click(section('Rules').getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Rules saved.')).toBeTruthy();
    expect(screen.queryByText('Basics saved.')).toBeNull();
    expect(bodyOf(patches(assignment.id)[1])).toEqual({ maxResubmissions: 1, acceptLate: true });
  });

  it('says the scoring format cannot change once there are submissions, and drops the earlier "saved"', async () => {
    const assignment = published();
    assignments = [assignment];
    const user = userEvent.setup();
    renderAt(`/assignments/${assignment.id}/edit`);

    await screen.findByRole('heading', { level: 1, name: 'Essay 2' });
    await user.click(section('Rules').getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Rules saved.')).toBeTruthy();

    refuseSave = () => failure(409, 'FORMAT_LOCKED');
    await user.selectOptions(screen.getByLabelText('Scoring format'), 'PERCENTAGE');
    await user.click(section('Due date and scoring').getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText("Scoring can't change after submissions exist.")).toBeTruthy();
    expect(screen.queryByText('Rules saved.')).toBeNull();
  });
});

describe('the class page, as a student', () => {
  beforeEach(() => {
    me = signedInAs('STUDENT');
    cls = aStudentClass();
  });

  it("lists the published assignments as links, with the due date in the student's own time zone", async () => {
    // Set in the far-away zone of Kiritimati (UTC+14), so a due date shown in the assignment's zone would be named as such.
    assignments = [
      anAssignment({ title: 'Essay 2', status: 'PUBLISHED', timezone: 'Pacific/Kiritimati' }),
      anAssignment({ title: 'Lab report', status: 'PUBLISHED', timezone: 'Pacific/Kiritimati' }),
      anAssignment({ title: 'Secret draft' }),
    ];
    renderAt(`/classes/${CLASS_ID}`);

    const essay = await screen.findByRole('link', { name: /Essay 2/ });
    expect(essay.getAttribute('href')).toBe(`/assignments/${assignments[0]?.id}`);
    expect(essay.textContent).toContain('Due ');
    expect(essay.textContent).toContain(`(${browserTimeZone()})`);
    expect(essay.textContent).not.toContain('Kiritimati');
    expect(screen.getByRole('link', { name: /Lab report/ })).toBeTruthy();
    expect(screen.queryByText('Secret draft')).toBeNull();
    expect(callsTo('GET', `/classes/${CLASS_ID}/assignments`)[0]?.path).toContain('status=PUBLISHED');
  });

  it('says so when there are no assignments yet', async () => {
    renderAt(`/classes/${CLASS_ID}`);

    expect(await screen.findByText('No assignments yet.')).toBeTruthy();
  });

  it('still lists them for an archived class, which is read-only', async () => {
    cls = aStudentClass({ status: 'ARCHIVED' });
    assignments = [anAssignment({ title: 'Essay 2', status: 'PUBLISHED' })];
    renderAt(`/classes/${CLASS_ID}`);

    expect(await screen.findByRole('link', { name: /Essay 2/ })).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('shows more assignments on request, following the cursor', async () => {
    pageSize = 1;
    assignments = [anAssignment({ title: 'First one', status: 'PUBLISHED' }), anAssignment({ title: 'Second one', status: 'PUBLISHED' })];
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}`);

    expect(await screen.findByRole('link', { name: /First one/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Second one/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show more assignments' }));

    expect(await screen.findByRole('link', { name: /Second one/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /First one/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more assignments' })).toBeNull();
  });

  it('opens an assignment from its row', async () => {
    assignments = [anAssignment({ title: 'Essay 2', status: 'PUBLISHED', criteriaText: 'Thesis is clear.' })];
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}`);

    await user.click(await screen.findByRole('link', { name: /Essay 2/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Essay 2' })).toBeTruthy();
    expect(screen.getByText('Thesis is clear.')).toBeTruthy();
  });

  it('says what went wrong with the list and lets the student try again', async () => {
    let works = false;
    assignments = [anAssignment({ title: 'Essay 2', status: 'PUBLISHED' })];
    const fake = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      !works && url.includes('/assignments?') ? Promise.resolve(failure(500, 'INTERNAL')) : fake(url, init),
    );
    const user = userEvent.setup();
    renderAt(`/classes/${CLASS_ID}`);

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    works = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: /Essay 2/ })).toBeTruthy();
  });
});

describe('the assignment page, as a student', () => {
  beforeEach(() => {
    me = signedInAs('STUDENT');
    cls = aStudentClass();
  });

  const published = (overrides: Partial<AssignmentDetail> = {}) => {
    const assignment = anAssignment({
      title: 'Essay 2',
      status: 'PUBLISHED',
      instructions: 'Write 500 words.\nCite two sources.',
      criteriaText: 'Thesis is clear (10 points).',
      maxScore: 50,
      timezone: 'Pacific/Kiritimati',
      ...overrides,
    });
    assignments = [assignment];
    return assignment;
  };

  it('shows what the student needs: when it is due, how it is scored, the late policy, the instructions and the criteria', async () => {
    const assignment = published();
    renderAt(`/assignments/${assignment.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Essay 2' })).toBeTruthy();
    expect(screen.getByText(/^Due /).textContent).toContain(`(${browserTimeZone()})`); // the student's own zone, not Kiritimati
    expect(screen.getByText('Scoring: 50 points')).toBeTruthy();
    expect(screen.getByText('Late submissions are accepted and marked Late.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Instructions' }).nextElementSibling?.textContent).toBe(
      'Write 500 words.\nCite two sources.',
    );
    expect(screen.getByRole('heading', { name: 'Criteria' }).nextElementSibling?.textContent).toBe('Thesis is clear (10 points).');
  });

  it('says that scores and feedback are AI-generated and reviewed by the instructor, in the words of the UX Brief', async () => {
    const assignment = published();
    renderAt(`/assignments/${assignment.id}`);

    expect(
      await screen.findByText(
        'Scores and feedback are AI-generated and reviewed by your instructor. Questions about grades go to your instructor.',
      ),
    ).toBeTruthy();
  });

  it('links back to the class by its name', async () => {
    const assignment = published();
    renderAt(`/assignments/${assignment.id}`);

    const back = await screen.findByRole('link', { name: 'Biology 101' });
    expect(back.getAttribute('href')).toBe(`/classes/${CLASS_ID}`);
  });

  it('marks an assignment of an archived class', async () => {
    cls = aStudentClass({ status: 'ARCHIVED' });
    const assignment = published();
    renderAt(`/assignments/${assignment.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Essay 2' });
    expect(await screen.findByText('Archived')).toBeTruthy();
  });

  it('leaves out instructions that were not given, and says when late work is not accepted', async () => {
    const assignment = published({ instructions: null, acceptLate: false });
    renderAt(`/assignments/${assignment.id}`);

    expect(await screen.findByText('Late submissions are not accepted.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Instructions' })).toBeNull();
  });

  it.each([
    ['an assignment the student cannot see (a draft, or one in another class)', () => failure(404, 'NOT_FOUND')],
    ['an address that is not an id', () => failure(400, 'VALIDATION')],
    ['a student who is still pending approval', () => failure(403, 'ENROLLMENT_PENDING')],
  ])('shows the same "not found" page for %s', async (_label, answer) => {
    denied = answer;
    renderAt(`/assignments/${crypto.randomUUID()}`);

    expect(await screen.findByRole('heading', { name: /couldn.t find that page/i })).toBeTruthy();
  });

  it('is not a page for an instructor, who has the tracker and the wizard for an assignment and gets the no-access page', async () => {
    me = signedInAs('INSTRUCTOR');
    const assignment = published();
    renderAt(`/assignments/${assignment.id}`);

    expect(await screen.findByRole('heading', { name: /you don.t have access to this page/i })).toBeTruthy();
    expect(screen.queryByText('Thesis is clear (10 points).')).toBeNull();
  });

  it('says what went wrong and lets the student try again', async () => {
    const assignment = published();
    denied = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt(`/assignments/${assignment.id}`);

    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on our side.');
    denied = undefined;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Essay 2' })).toBeTruthy();
  });
});

describe('reference files', () => {
  const aFile = (ordinal: number, overrides: Partial<ReferenceFileView> = {}): ReferenceFileView => ({
    id: crypto.randomUUID(),
    ordinal,
    label: `Reference file ${ordinal}`,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    visibleToStudents: false,
    ...overrides,
  });
  const pdf = (name = 'rubric.pdf') => new File([new Uint8Array(2048)], name, { type: 'application/pdf' });
  const addInput = () => screen.getByLabelText('Add a reference file') as HTMLInputElement;
  const rows = () =>
    within(screen.getByRole('region', { name: 'Reference files (optional, up to 3)' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
  const stepTwo = async (assignment: AssignmentDetail) => {
    renderAt(`/assignments/${assignment.id}/edit?step=2`);
    await screen.findByLabelText('Grading criteria');
  };

  it('lists the files of a draft with their size, and adds one: the file goes in a form, and then shows in the list', async () => {
    const draft = anAssignment({ referenceFiles: [aFile(1)] });
    assignments = [draft];
    const user = userEvent.setup();
    await stepTwo(draft);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Reference file 1 (2 KB)');
    await user.upload(addInput(), pdf('rubric.pdf'));

    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[1]).toContain('Reference file 2 (2 KB)');
    const [post] = callsTo('POST', `/assignments/${draft.id}/reference-files`);
    expect(post?.body).toBeInstanceOf(FormData);
    expect(((post?.body as FormData).get('file') as File).name).toBe('rubric.pdf');
  });

  it('turns visibility on for one file, which is off to begin with', async () => {
    const draft = anAssignment({ referenceFiles: [aFile(1)] });
    assignments = [draft];
    const user = userEvent.setup();
    await stepTwo(draft);

    const box = screen.getByRole('checkbox', { name: 'Visible to students, Reference file 1' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);

    await vi.waitFor(() =>
      expect((screen.getByRole('checkbox', { name: 'Visible to students, Reference file 1' }) as HTMLInputElement).checked).toBe(true),
    );
    expect(callsTo('PATCH', `/reference-files/${draft.referenceFiles[0]?.id}`)[0]?.body).toEqual({ visibleToStudents: true });
  });

  it('removes a file', async () => {
    const draft = anAssignment({ referenceFiles: [aFile(1), aFile(2)] });
    assignments = [draft];
    const user = userEvent.setup();
    await stepTwo(draft);

    await user.click(screen.getByRole('button', { name: 'Remove Reference file 1' }));

    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('Reference file 2');
    expect(callsTo('DELETE', '/reference-files/')).toHaveLength(1);
  });

  it('offers no more files once there are three, and says so when the server refuses a fourth', async () => {
    const full = anAssignment({ referenceFiles: [aFile(1), aFile(2), aFile(3)] });
    assignments = [full];
    await stepTwo(full);
    expect(addInput().disabled).toBe(true);
    cleanup();

    const room = anAssignment({ referenceFiles: [aFile(1)] });
    assignments = [room];
    refuseReference = () => failure(422, 'FILE_LIMIT', undefined, { limit: 'reference-count' });
    const user = userEvent.setup();
    await stepTwo(room);
    await user.upload(addInput(), pdf());

    expect((await screen.findByRole('alert')).textContent).toBe('You can add up to 3 reference files.');
  });

  it('lists the files of a published assignment and lets the instructor show or hide them, but not add or remove (that needs the re-grade confirmation)', async () => {
    const published = anAssignment({ status: 'PUBLISHED', criteriaText: 'Thesis is clear (10 points).', referenceFiles: [aFile(1)] });
    assignments = [published];
    const user = userEvent.setup();
    renderAt(`/assignments/${published.id}/edit`);

    await user.click(await screen.findByRole('checkbox', { name: 'Visible to students, Reference file 1' }));

    await vi.waitFor(() => expect(callsTo('PATCH', `/reference-files/${published.referenceFiles[0]?.id}`)).toHaveLength(1));
    expect(screen.queryByLabelText('Add a reference file')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  describe('as a student', () => {
    beforeEach(() => {
      me = signedInAs('STUDENT');
      cls = aStudentClass();
    });

    it('lists the visible files with an Open button that opens a fresh link in a new tab', async () => {
      const file = aFile(2, { visibleToStudents: true });
      const assignment = anAssignment({ status: 'PUBLISHED', criteriaText: 'Thesis is clear (10 points).', referenceFiles: [file] }); // the API sends a student only the visible ones
      assignments = [assignment];
      const tab = { location: { href: '' }, opener: window as unknown, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      const user = userEvent.setup();
      renderAt(`/assignments/${assignment.id}`);

      const heading = await screen.findByRole('heading', { name: 'Reference files' });
      const items = within(heading.closest('section')!).getAllByRole('listitem');
      expect(items).toHaveLength(1);
      expect(items[0]?.textContent).toContain('Reference file 2');
      await user.click(screen.getByRole('button', { name: 'Open Reference file 2' }));

      await vi.waitFor(() => expect(tab.location.href).toBe(`https://files.example/${file.id}`));
      expect(tab.opener).toBeNull(); // the new page cannot reach back to this one
      expect(callsTo('GET', `/reference-files/${file.id}/url`)).toHaveLength(1);
    });

    it('shows no Reference files part when there is nothing visible, and says so in an alert when a link cannot be made', async () => {
      const none = anAssignment({ status: 'PUBLISHED', criteriaText: 'x' });
      assignments = [none];
      renderAt(`/assignments/${none.id}`);
      expect(await screen.findByRole('heading', { level: 1, name: 'Essay 2' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Reference files' })).toBeNull();
      cleanup();

      const file = aFile(1, { visibleToStudents: true });
      const gone = anAssignment({ status: 'PUBLISHED', criteriaText: 'x', referenceFiles: [file] });
      assignments = [gone];
      const tab = { location: { href: '' }, opener: window as unknown, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      const user = userEvent.setup();
      renderAt(`/assignments/${gone.id}`);
      await user.click(await screen.findByRole('button', { name: 'Open Reference file 1' }));
      assignments = []; // the file is hidden or removed meanwhile, so the link is refused
      await user.click(screen.getByRole('button', { name: 'Open Reference file 1' }));

      expect((await screen.findAllByRole('alert')).some((alert) => alert.textContent === 'Something went wrong.')).toBe(true);
      expect(tab.close).toHaveBeenCalled();
    });
  });
});
