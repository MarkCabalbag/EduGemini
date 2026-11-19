// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { AssignmentDetail, ClassSummary, GradeView, Me, StudentSubmission } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The page asks again every 5 seconds while a submission is being graded; here it asks every 50 ms so the tests need no fake clock.
vi.mock('../lib/polling', () => ({ POLL_MS: { notificationBadge: 60_000, studentSubmission: 50 } }));

// The real pages and routing run. Only the API is replaced by a small in-memory fake.

const CLASS_ID = '9b1d6a52-1c0e-4e57-8d5c-0d3f4a9f7b22';
const ASSIGNMENT_ID = '5d0f6a52-1c0e-4e57-8d5c-0d3f4a9f7b33';

const student: Me = {
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'jon@example.com',
  firstName: 'Jon',
  lastName: 'Reyes',
  role: 'STUDENT',
  emailVerified: true,
  suspended: false,
};

const aClass = (status: ClassSummary['status'] = 'ACTIVE'): ClassSummary => ({
  id: CLASS_ID,
  name: 'Biology 101',
  description: null,
  section: null,
  subject: null,
  room: null,
  status,
  instructorName: 'Maria R.',
  enrollment: { status: 'ACTIVE' },
});

const assignment: AssignmentDetail = {
  id: ASSIGNMENT_ID,
  classId: CLASS_ID,
  title: 'Essay 2',
  instructions: null,
  criteriaText: 'Thesis is clear (10 points).',
  dueAt: '2026-12-01T15:59:00.000Z',
  timezone: 'Asia/Manila',
  status: 'PUBLISHED',
  scoringFormat: 'POINTS',
  maxScore: 50,
  maxResubmissions: 3,
  acceptLate: true,
  criteriaVersion: 1,
  referenceFiles: [],
};

const FEEDBACK = 'Clear thesis.\nThe second paragraph needs a source.';
const aiGrade: GradeView = {
  source: 'AI',
  score: 42,
  maxScore: 50,
  scoringFormat: 'POINTS',
  letter: null,
  percentage: 84,
  feedback: FEEDBACK,
  chip: 'status-ai',
};

const submission = (overrides: Partial<StudentSubmission> = {}): StudentSubmission => ({
  state: 'GRADING',
  isLate: false,
  closed: false,
  attemptsLeft: 3,
  unlimited: false,
  firstSubmittedAt: '2026-11-16T06:00:00.000Z',
  latestSubmittedAt: '2026-11-16T06:00:00.000Z',
  files: [],
  grade: null,
  instructorComment: null,
  draftVersion: null,
  ...overrides,
});

let mine: StudentSubmission;
let archived: boolean;
let mineCalls: number;

beforeEach(() => {
  mine = submission();
  archived = false;
  mineCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      if (path === '/me') return Response.json(student);
      if (path === `/classes/${CLASS_ID}`) return Response.json(aClass(archived ? 'ARCHIVED' : 'ACTIVE'));
      if (path === `/assignments/${ASSIGNMENT_ID}`) return Response.json(assignment);
      if ((init?.method ?? 'GET') === 'GET' && path === `/assignments/${ASSIGNMENT_ID}/me`) {
        mineCalls++;
        return Response.json(mine);
      }
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openPage = () => renderAt(`/assignments/${ASSIGNMENT_ID}`);

describe('the student result', () => {
  it('shows the score, the feedback and the AI-generated chip once grading is done, with the disclosure beside them', async () => {
    mine = submission({ state: 'AI_GENERATED', grade: aiGrade });
    openPage();

    expect(await screen.findByText('AI-generated')).toBeTruthy();
    expect(screen.getByText('42 / 50')).toBeTruthy();
    expect(screen.getByText(/The second paragraph needs a source\./)).toBeTruthy();
    expect(
      screen.getByText(
        'Scores and feedback are AI-generated and reviewed by your instructor. Questions about grades go to your instructor.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Grading in progress/)).toBeNull();
  });

  it('keeps the state chip in a live region, so a screen reader hears Grading change to the result (UX Brief §12)', async () => {
    openPage();
    const grading = await screen.findByText('Grading in progress, usually about a minute');
    const region = grading.closest('[role="status"]'); // the same element stays on the page, so the change is announced
    expect(region).toBeTruthy();

    mine = submission({ state: 'AI_GENERATED', grade: aiGrade });
    await waitFor(() => expect(region!.textContent).toContain('AI-generated'));
  });

  it('writes the score in the assignment format: a percentage, and a letter assignment without a letter yet', async () => {
    mine = submission({ state: 'AI_GENERATED', grade: { ...aiGrade, scoringFormat: 'PERCENTAGE', score: 84, maxScore: 100 } });
    openPage();
    expect(await screen.findByText('84%')).toBeTruthy();
    cleanup();

    mine = submission({
      state: 'AI_GENERATED',
      grade: { ...aiGrade, scoringFormat: 'LETTER_NUMERIC', score: 87, maxScore: 100, percentage: 87 },
    });
    openPage();
    expect(await screen.findByText('87 / 100')).toBeTruthy();
  });

  it('shows the instructor-approved chip and the instructor comment', async () => {
    mine = submission({
      state: 'INSTRUCTOR_APPROVED',
      grade: { ...aiGrade, source: 'INSTRUCTOR', chip: 'status-approved' },
      instructorComment: 'See me after class.',
    });
    openPage();

    expect(await screen.findByText('Instructor-approved')).toBeTruthy();
    expect(screen.getByText('See me after class.')).toBeTruthy();
  });

  it('shows no score while the instructor still has to review it', async () => {
    mine = submission({ state: 'AWAITING_REVIEW' });
    openPage();

    expect(await screen.findByText('Submitted, awaiting instructor review')).toBeTruthy();
    expect(screen.queryByText('Score')).toBeNull();
    expect(screen.queryByText('Feedback')).toBeNull();
  });

  it('still shows the result in an archived class, which is read-only', async () => {
    archived = true;
    mine = submission({ state: 'AI_GENERATED', grade: aiGrade });
    openPage();

    expect(await screen.findByText('42 / 50')).toBeTruthy();
    await screen.findByText('Archived');
  });
});

describe('waiting for the result', () => {
  it('changes from "Grading in progress" to the result by itself, and then stops asking', async () => {
    openPage();
    expect(await screen.findByText('Grading in progress, usually about a minute')).toBeTruthy();
    await waitFor(() => expect(mineCalls).toBeGreaterThan(1)); // it keeps asking while grading

    mine = submission({ state: 'AI_GENERATED', grade: aiGrade });
    expect(await screen.findByText('42 / 50')).toBeTruthy();
    expect(screen.queryByText(/Grading in progress/)).toBeNull();

    const settled = mineCalls;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mineCalls).toBe(settled);
  });

  it('does not ask again once the result is shown', async () => {
    mine = submission({ state: 'AI_GENERATED', grade: aiGrade });
    openPage();
    await screen.findByText('42 / 50');

    const settled = mineCalls;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mineCalls).toBe(settled);
  });

  it('keeps the files of an open upload on the page while it asks again', async () => {
    mine = submission({
      state: 'UPLOADING',
      draftVersion: {
        id: '7e1d6a52-1c0e-4e57-8d5c-0d3f4a9f7b44',
        versionNo: 1,
        status: 'UPLOADING',
        createdAt: '2026-11-16T01:00:00.000Z',
        storedAt: null,
        files: [
          {
            id: crypto.randomUUID(),
            clientFileId: 'earlier-file-1',
            ordinal: 1,
            displayName: 'essay.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            pageCount: null,
            status: 'STORED',
            failureCode: null,
          },
        ],
      },
    });
    openPage();
    await screen.findByText('essay.pdf');

    await waitFor(() => expect(mineCalls).toBeGreaterThan(2));
    expect(screen.getByText('essay.pdf')).toBeTruthy();
    expect(screen.getByLabelText('Add photos or PDF')).toBeTruthy();
  });
});
