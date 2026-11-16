// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentDetail, ClassSummary, Me, PublishWarning, UpdateAssignment } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  ...overrides,
});

type Call = { path: string; method: string; body?: unknown };

let calls: Call[];
let me: Me;
let cls: ClassSummary;
let assignments: AssignmentDetail[];
let publishResult: (assignment: AssignmentDetail) => Response;

beforeEach(() => {
  calls = [];
  me = signedInAs('INSTRUCTOR');
  cls = aClass();
  assignments = [];
  publishResult = (assignment) => {
    assignment.status = 'PUBLISHED';
    return Response.json({ ...assignment, warnings: [] satisfies PublishWarning[] });
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, method, body });

      if (path === '/me') return Response.json(me);
      if (method === 'GET' && path === `/classes/${cls.id}`) return Response.json(cls);

      const list = /^\/classes\/[^/?]+\/assignments\?(.*)$/.exec(path);
      if (method === 'GET' && list) {
        const status = new URLSearchParams(list[1]).get('status');
        return Response.json({ items: assignments.filter((a) => a.status === status), nextCursor: null });
      }
      if (method === 'POST' && /^\/classes\/[^/?]+\/assignments$/.test(path)) {
        const input = body as Partial<AssignmentDetail> & { title: string };
        const created = anAssignment({ title: input.title, instructions: input.instructions || null, timezone: input.timezone ?? 'UTC' });
        assignments.push(created);
        return Response.json(created, { status: 201 });
      }

      const one = /^\/assignments\/([^/?]+)(\/publish)?$/.exec(path);
      const found = assignments.find((a) => a.id === one?.[1]);
      if (!one) return failure(404, 'NOT_FOUND');
      if (!found) return failure(404, 'NOT_FOUND');
      if (method === 'GET') return Response.json(found);
      if (method === 'POST' && one[2]) return publishResult(found);
      if (method === 'PATCH') {
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
    expect(within(draft).getByRole('link', { name: 'Resume Lab report' }).getAttribute('href')).toBe(`/assignments/${assignments[0]?.id}/edit`);

    const published = screen.getByText('Essay 2').closest('li')!;
    expect(published.textContent).toContain('Percentage · No resubmissions');
    expect(within(published).queryByText('Draft')).toBeNull();
    expect(within(published).queryByRole('link', { name: /Resume/ })).toBeNull(); // not editable yet

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Drafts', 'Published']);
    expect(screen.getByRole('link', { name: 'New assignment' })).toBeTruthy(); // in the header once there are assignments
  });

  it('is read-only for an archived class: nothing to create or resume', async () => {
    cls = aClass({ status: 'ARCHIVED' });
    assignments = [anAssignment({ title: 'Lab report' })];
    open();

    expect(await screen.findByText('Lab report')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New assignment' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Resume/ })).toBeNull();
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
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Overview', 'Assignments', 'People']);
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

  it('is not for a student', async () => {
    me = signedInAs('STUDENT');
    renderAt(`/classes/${CLASS_ID}/assignments/new`);

    expect(await screen.findByText(/couldn.t find that page/i)).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
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

  it('shows a published assignment as published, not as a form', async () => {
    const published = anAssignment({ status: 'PUBLISHED' });
    assignments = [published];
    renderAt(`/assignments/${published.id}/edit`);

    expect(await screen.findByText(/cannot be edited yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('shows the same page as a missing one for an assignment that is not found', async () => {
    renderAt(`/assignments/${crypto.randomUUID()}/edit`);

    expect(await screen.findByText(/couldn.t find that page/i)).toBeTruthy();
  });
});
