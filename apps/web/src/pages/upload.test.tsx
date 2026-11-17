// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentDetail, ClassSummary, Me, StudentSubmission } from '@edugemini/shared';
import { LIMITS } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr } from '../test/fake-xhr';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a small in-memory fake.

const CLASS_ID = '9b1d6a52-1c0e-4e57-8d5c-0d3f4a9f7b22';
const ASSIGNMENT_ID = '5d0f6a52-1c0e-4e57-8d5c-0d3f4a9f7b33';
const VERSION_ID = '7e1d6a52-1c0e-4e57-8d5c-0d3f4a9f7b44';

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
  maxScore: 100,
  maxResubmissions: 3,
  acceptLate: true,
  criteriaVersion: 1,
  referenceFiles: [],
};

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pdf = (name = 'essay.pdf') => new File([new Uint8Array([...PDF_BYTES, 1, 2, 3])], name, { type: 'application/pdf' });
const png = (name = 'photo.png') => new File([new Uint8Array([...PNG_BYTES, 1, 2, 3])], name, { type: 'image/png' });

type Call = { method: string; path: string; init?: RequestInit };
let calls: Call[];
let archived: boolean;
let openUpload: () => Response | Promise<Response>;
let sendFile: (call: Call) => Response | Promise<Response>;
let mine: StudentSubmission;
let mineAnswer: () => Response;
let finalizeAnswer: (call: Call) => Response | Promise<Response>;
let removeAnswer: (call: Call) => Response | Promise<Response>;

const callsTo = (method: string, pathStart: string) => calls.filter((c) => c.method === method && c.path.startsWith(pathStart));
const input = () => screen.getByLabelText('Add photos or PDF');
const fileView = (ordinal = 1) => ({
  id: crypto.randomUUID(),
  clientFileId: crypto.randomUUID(),
  ordinal,
  displayName: 'x',
  mimeType: 'application/pdf',
  sizeBytes: 8,
  pageCount: null,
  status: 'STORED',
  failureCode: null,
});
const version = { id: VERSION_ID, versionNo: 1, status: 'UPLOADING', createdAt: '2026-11-16T01:00:00.000Z', storedAt: null };
/** An open upload that already holds these files, stored on an earlier visit. Their keys are earlier-file-1, earlier-file-2 and so on. */
const draftOf = (names: string[]) => ({
  ...version,
  status: 'UPLOADING' as const,
  files: names.map((name, i) => ({ ...fileView(i + 1), clientFileId: `earlier-file-${i + 1}`, displayName: name, sizeBytes: 2048, status: 'STORED' as const })),
});

const submission = (overrides: Partial<StudentSubmission> = {}): StudentSubmission => ({
  state: 'NOT_SUBMITTED',
  isLate: false,
  closed: false,
  attemptsLeft: 3,
  unlimited: false,
  firstSubmittedAt: null,
  latestSubmittedAt: null,
  files: [],
  grade: null,
  instructorComment: null,
  draftVersion: null,
  ...overrides,
});
/** What the server answers once the files are submitted: queued for grading, with the files named. */
const submitted = (names: string[]) =>
  submission({
    state: 'GRADING',
    firstSubmittedAt: '2026-11-16T06:00:00.000Z',
    latestSubmittedAt: '2026-11-16T06:00:00.000Z',
    files: names.map((name, i) => ({ ...fileView(i + 1), displayName: name, status: 'STORED' as const })),
  });

beforeEach(() => {
  calls = [];
  archived = false;
  openUpload = () => Response.json(version, { status: 201 });
  sendFile = () => Response.json(fileView(), { status: 201 });
  mine = submission();
  mineAnswer = () => Response.json(mine);
  finalizeAnswer = () => Response.json(submitted(['a.pdf']));
  removeAnswer = () => new Response(null, { status: 204 });

  vi.stubGlobal('XMLHttpRequest', FakeXhr); // files go by XMLHttpRequest, which hands each request to the fetch below
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      const call = { method, path, init };
      calls.push(call);

      if (path === '/me') return Response.json(student);
      if (path === `/classes/${CLASS_ID}`) return Response.json(aClass(archived ? 'ARCHIVED' : 'ACTIVE'));
      if (method === 'GET' && path === `/assignments/${ASSIGNMENT_ID}`) return Response.json(assignment);
      if (method === 'GET' && path === `/assignments/${ASSIGNMENT_ID}/me`) return mineAnswer();
      if (method === 'POST' && path === `/versions/${VERSION_ID}/finalize`) return finalizeAnswer(call);
      if (method === 'POST' && path === `/assignments/${ASSIGNMENT_ID}/versions`) return openUpload();
      if (method === 'PUT' && path.startsWith(`/versions/${VERSION_ID}/files/`)) return sendFile(call);
      if (method === 'DELETE' && path.startsWith(`/versions/${VERSION_ID}/files/`)) return removeAnswer(call);
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPage() {
  renderAt(`/assignments/${ASSIGNMENT_ID}`);
  await screen.findByRole('heading', { name: 'Your files' });
}

describe('the student upload control', () => {
  it('shows the limits and the button, below the criteria', async () => {
    await openPage();
    // The sentence is one paragraph, so its text is matched as a whole.
    expect(screen.getByText('PDF, JPG or PNG. Up to 10 files, 10 MB each, 15 MB in total. PDFs up to 20 pages.')).toBeTruthy();
    expect(input().getAttribute('accept')).toBe('application/pdf,image/jpeg,image/png');
    expect(input().hasAttribute('multiple')).toBe(true);
  });

  it('is not there in an archived class, which is read-only', async () => {
    archived = true;
    renderAt(`/assignments/${ASSIGNMENT_ID}`);
    await screen.findByText('Archived');
    expect(screen.queryByRole('heading', { name: 'Your files' })).toBeNull();
  });

  it('opens the upload, sends the raw file with its name and type, and shows it as uploaded', async () => {
    await openPage();
    const file = pdf('My essay (final).pdf');
    await userEvent.upload(input(), file);

    await screen.findByText('Uploaded');
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(1);
    const put = callsTo('PUT', `/versions/${VERSION_ID}/files/`)[0]!;
    expect(put.init?.body).toBe(file); // the bytes as they are, not a form and not JSON
    expect(put.init?.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('My essay (final).pdf'),
    });
    expect(screen.getByText('My essay (final).pdf')).toBeTruthy();
  });

  it('opens the upload once for several files, and sends them one after another', async () => {
    let active = 0;
    let mostAtOnce = 0;
    sendFile = async () => {
      mostAtOnce = Math.max(mostAtOnce, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return Response.json(fileView(), { status: 201 });
    };
    await openPage();
    await userEvent.upload(input(), [pdf('a.pdf'), png('b.png'), pdf('c.pdf')]);

    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(3));
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(1);
    expect(callsTo('PUT', '/versions/')).toHaveLength(3);
    expect(mostAtOnce).toBe(1);
  });

  it('sends an image as it is when the browser cannot make it smaller', async () => {
    await openPage(); // jsdom has no image decoder, like a browser that cannot resize
    const photo = png();
    await userEvent.upload(input(), photo);

    await screen.findByText('Uploaded');
    expect(callsTo('PUT', '/versions/')[0]!.init?.body).toBe(photo);
  });

  it('refuses a file that is not a PDF, JPG or PNG when it is chosen, whatever it is called', async () => {
    await openPage();
    const docx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])], 'essay.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const fakePdf = new File(['just some text'], 'essay.pdf', { type: 'application/pdf' });
    fireEvent.change(input(), { target: { files: [docx, fakePdf] } });

    expect(await screen.findAllByText("This file type isn't supported. Use PDF, JPG, or PNG.")).toHaveLength(2);
    expect(callsTo('POST', '/assignments/')).toHaveLength(0); // nothing was opened or sent
    expect(callsTo('PUT', '/versions/')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Remove essay.docx' }));
    expect(screen.queryByText('essay.docx')).toBeNull();
    expect(screen.getByText('essay.pdf')).toBeTruthy();
  });

  it('refuses a PDF over 10 MB when it is chosen, without sending it', async () => {
    await openPage();
    const big = new Uint8Array(LIMITS.maxFileBytes + 1);
    big.set(PDF_BYTES);
    fireEvent.change(input(), { target: { files: [new File([big], 'huge.pdf', { type: 'application/pdf' })] } });

    expect(await screen.findByText('This file is larger than 10 MB.')).toBeTruthy();
    expect(callsTo('PUT', '/versions/')).toHaveLength(0);
  });

  it.each([
    ['files', 'You can upload up to 10 files.'],
    ['pages', 'This PDF has more than 20 pages.'],
    ['total-size', 'Your files add up to more than 15 MB.'],
  ])('names the %s limit when the server refuses the file, with no Retry', async (limit, text) => {
    sendFile = () => failure(422, 'FILE_LIMIT', undefined, { limit });
    await openPage();
    await userEvent.upload(input(), pdf());

    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove essay.pdf' })).toBeTruthy();
  });

  it('shows the server\'s own message for a file it cannot read', async () => {
    sendFile = () => failure(422, 'FILE_ERROR', undefined, { failureCode: 'PASSWORD' });
    await openPage();
    await userEvent.upload(input(), pdf());
    expect(await screen.findByText("This file couldn't be read. Try re-saving it or choosing a different file.")).toBeTruthy();
  });

  it('offers Retry when the network fails, and a retry sends the same file under the same key', async () => {
    let attempt = 0;
    sendFile = () => {
      if (++attempt === 1) throw new TypeError('network down');
      return Response.json(fileView(), { status: 201 });
    };
    await openPage();
    await userEvent.upload(input(), pdf());

    expect(await screen.findByText(/Couldn't upload\. You're offline/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry essay.pdf' }));
    await screen.findByText('Uploaded');

    const puts = callsTo('PUT', '/versions/');
    expect(puts).toHaveLength(2);
    expect(puts[1]!.path).toBe(puts[0]!.path); // the server replaces a file sent again with the same key, so it never doubles
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(1);
  });

  it('asks for the upload again when opening it failed: the next file opens it, and the failed one can be retried', async () => {
    let attempt = 0;
    openUpload = () => (++attempt === 1 ? failure(500, 'INTERNAL') : Response.json(version, { status: 201 }));
    await openPage();
    await userEvent.upload(input(), [pdf('a.pdf'), pdf('b.pdf')]);

    const row = (name: string) => within(screen.getByText(name).closest('li')!);
    await waitFor(() => expect(row('b.pdf').getByText('Uploaded')).toBeTruthy()); // b opened it, after a's try failed
    expect(row('a.pdf').getByText(/Couldn't upload\. Something went wrong on our side\./)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Retry a.pdf' }));
    await waitFor(() => expect(row('a.pdf').getByText('Uploaded')).toBeTruthy());
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(2); // the retry reused the open upload
  });

  it('says so when the class turns out to be archived', async () => {
    openUpload = () => failure(409, 'CLASS_ARCHIVED');
    await openPage();
    await userEvent.upload(input(), pdf());
    expect(await screen.findByText('This class is archived and read-only.')).toBeTruthy();
  });
});

describe('submitting the files', () => {
  const submitButton = () => screen.getByRole('button', { name: 'Submit files' }) as HTMLButtonElement;

  it('keeps Submit disabled until every file is stored, and says why', async () => {
    let release = () => {};
    sendFile = () => new Promise<Response>((resolve) => (release = () => resolve(Response.json(fileView(), { status: 201 }))));
    await openPage();
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText('Add a file to submit.')).toBeTruthy();

    await userEvent.upload(input(), pdf());
    expect(await screen.findByText('Waiting for 1 file to finish uploading')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    release();
    expect(await screen.findByText('1 file ready to submit')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it('keeps Submit disabled while a file was refused, until it is removed', async () => {
    await openPage();
    fireEvent.change(input(), { target: { files: [new File(['just some text'], 'notes.pdf', { type: 'application/pdf' })] } });

    expect(await screen.findByText("1 file couldn't be uploaded. Retry or remove it.")).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove notes.pdf' }));
    expect(screen.getByText('Add a file to submit.')).toBeTruthy();
  });

  it('lets a file that could not be sent be removed, so it cannot hold Submit back for good', async () => {
    sendFile = () => failure(500, 'INTERNAL');
    await openPage();
    await userEvent.upload(input(), pdf());

    await userEvent.click(await screen.findByRole('button', { name: 'Remove essay.pdf' }));
    expect(screen.queryByText('essay.pdf')).toBeNull();
  });

  it('sends the stored files in the order shown, then shows the receipt in place of the upload control', async () => {
    finalizeAnswer = () => Response.json(submitted(['a.pdf', 'b.png']));
    await openPage();
    await userEvent.upload(input(), [pdf('a.pdf'), png('b.png')]);
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));

    await userEvent.click(submitButton());

    expect(await screen.findByRole('heading', { name: 'Your submission' })).toBeTruthy();
    const sent = callsTo('PUT', '/versions/').map((call) => call.path.split('/').pop());
    const finalize = callsTo('POST', `/versions/${VERSION_ID}/finalize`);
    expect(finalize).toHaveLength(1);
    expect(JSON.parse(finalize[0]!.init!.body as string)).toEqual({ expectedFileIds: sent });
    expect(screen.getByText('Grading in progress, usually about a minute')).toBeTruthy();
    expect(screen.getByText(/^Submitted /)).toBeTruthy();
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.png')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your files' })).toBeNull();
  });

  it('shows why it failed and keeps the files, so Submit can be pressed again', async () => {
    finalizeAnswer = () => failure(409, 'UPLOAD_INCOMPLETE', undefined, { missing: ['x'] });
    await openPage();
    await userEvent.upload(input(), pdf());
    await screen.findByText('Uploaded');
    await userEvent.click(submitButton());

    expect((await screen.findByRole('alert')).textContent).toContain("Some files haven't finished uploading.");
    expect(screen.getByText('essay.pdf')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it.each([
    [409, 'ATTEMPTS_EXHAUSTED', undefined, "You've used all your resubmissions. Your instructor can give you more."],
    [422, 'FILE_LIMIT', { limit: 'total-size' }, 'Your files add up to more than 15 MB.'],
    [422, 'FILE_LIMIT', { limit: 'grading-budget' }, 'These files are too large to grade together. Remove one and try again.'],
    [409, 'CLASS_ARCHIVED', undefined, 'This class is archived and read-only.'],
    [409, 'LATE_CLOSED', undefined, 'Late submissions are closed for this assignment.'],
  ])('says what went wrong for %s %s', async (status, code, details, text) => {
    finalizeAnswer = () => failure(status as number, code as string, undefined, details);
    await openPage();
    await userEvent.upload(input(), pdf());
    await screen.findByText('Uploaded');
    await userEvent.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });
});

describe('progress', () => {
  it('shows how much of a file has been sent while it is on its way, then Uploaded', async () => {
    let release = () => {};
    sendFile = () => new Promise<Response>((resolve) => (release = () => resolve(Response.json(fileView(), { status: 201 }))));
    await openPage();
    await userEvent.upload(input(), pdf());

    expect(await screen.findByText('Uploading…')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Waiting for 1 file to finish uploading')).toBeTruthy();

    release();
    expect(await screen.findByText('Uploaded')).toBeTruthy();
    expect(screen.queryByText('50%')).toBeNull();
  });
});

describe('an upload that is still open', () => {
  const submitButton = () => screen.getByRole('button', { name: 'Submit files' }) as HTMLButtonElement;
  const row = (name: string) => within(screen.getByText(name).closest('li')!);
  const stillOpen = (names: string[]) => (mine = submission({ state: 'UPLOADING', draftVersion: draftOf(names) }));

  it('lists the files already stored, ready to submit, without opening the upload again', async () => {
    stillOpen(['page1.jpg', 'page2.jpg']);
    await openPage();

    expect(row('page1.jpg').getByText('Uploaded')).toBeTruthy();
    expect(row('page2.jpg').getByText('Uploaded')).toBeTruthy();
    expect(row('page1.jpg').getByText('2 KB')).toBeTruthy(); // the size comes from the server
    expect(screen.getByText('2 files ready to submit')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(0);
  });

  it('submits the files stored earlier together with new ones, in the order shown', async () => {
    stillOpen(['page1.jpg', 'page2.jpg']);
    await openPage();
    await userEvent.upload(input(), pdf('page3.pdf'));
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(3));

    await userEvent.click(submitButton());
    await screen.findByRole('heading', { name: 'Your submission' });
    const sent = callsTo('PUT', '/versions/').map((call) => call.path.split('/').pop());
    expect(sent).toHaveLength(1);
    const finalize = callsTo('POST', `/versions/${VERSION_ID}/finalize`);
    expect(JSON.parse(finalize[0]!.init!.body as string)).toEqual({ expectedFileIds: ['earlier-file-1', 'earlier-file-2', sent[0]] });
    expect(callsTo('POST', `/assignments/${ASSIGNMENT_ID}/versions`)).toHaveLength(0); // the upload was already open
  });

  it('removes a stored file from the server, and the list and the count follow', async () => {
    stillOpen(['page1.jpg', 'page2.jpg']);
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Remove page1.jpg' }));

    await waitFor(() => expect(screen.queryByText('page1.jpg')).toBeNull());
    expect(callsTo('DELETE', '/versions/')).toHaveLength(1);
    expect(callsTo('DELETE', '/versions/')[0]!.path).toBe(`/versions/${VERSION_ID}/files/earlier-file-1`);
    expect(screen.getByText('page2.jpg')).toBeTruthy();
    expect(screen.getByText('1 file ready to submit')).toBeTruthy();
  });

  it('removes a file stored in this visit the same way', async () => {
    await openPage();
    await userEvent.upload(input(), pdf());
    await screen.findByText('Uploaded');
    const stored = callsTo('PUT', '/versions/')[0]!.path;

    await userEvent.click(screen.getByRole('button', { name: 'Remove essay.pdf' }));
    await waitFor(() => expect(screen.queryByText('essay.pdf')).toBeNull());
    expect(callsTo('DELETE', '/versions/')[0]!.path).toBe(stored);
    expect(screen.getByText('Add a file to submit.')).toBeTruthy();
  });

  it('says Removing and keeps Submit disabled while a file is being taken off', async () => {
    let release = () => {};
    removeAnswer = () => new Promise<Response>((resolve) => (release = () => resolve(new Response(null, { status: 204 }))));
    stillOpen(['page1.jpg', 'page2.jpg']);
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Remove page1.jpg' }));

    expect(await screen.findByText('Removing…')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.queryByText('page1.jpg')).toBeNull());
    expect(submitButton().disabled).toBe(false);
  });

  it('keeps the file and says why when it could not be removed, and Remove can be pressed again', async () => {
    removeAnswer = () => failure(500, 'INTERNAL');
    stillOpen(['page1.jpg']);
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Remove page1.jpg' }));

    expect(await screen.findByText("Couldn't remove it. Something went wrong on our side.")).toBeTruthy();
    expect(row('page1.jpg').getByText('Uploaded')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);

    removeAnswer = () => new Response(null, { status: 204 });
    await userEvent.click(screen.getByRole('button', { name: 'Remove page1.jpg' }));
    await waitFor(() => expect(screen.queryByText('page1.jpg')).toBeNull());
  });

  it('picks up the files stored since an earlier visit, not the ones the cache remembers', async () => {
    const client = renderAt(`/assignments/${ASSIGNMENT_ID}`);
    await screen.findByRole('heading', { name: 'Your files' }); // the cache now says nothing is open
    cleanup();

    stillOpen(['page1.jpg']); // stored meanwhile
    renderAt(`/assignments/${ASSIGNMENT_ID}`, client);
    expect(await screen.findByText('page1.jpg')).toBeTruthy();
  });
});

describe('a student who has already submitted', () => {
  it('sees the receipt and no upload control when they come back', async () => {
    mine = submitted(['essay.pdf', 'page2.png']);
    renderAt(`/assignments/${ASSIGNMENT_ID}`);

    expect(await screen.findByRole('heading', { name: 'Your submission' })).toBeTruthy();
    expect(screen.getByText('Grading in progress, usually about a minute')).toBeTruthy();
    expect(screen.getByText('essay.pdf')).toBeTruthy();
    expect(screen.getByText('page2.png')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your files' })).toBeNull();
  });

  it('sees the receipt in an archived class too, read-only', async () => {
    archived = true;
    mine = submitted(['essay.pdf']);
    renderAt(`/assignments/${ASSIGNMENT_ID}`);
    expect(await screen.findByRole('heading', { name: 'Your submission' })).toBeTruthy();
  });

  it('marks a late submission Late', async () => {
    mine = { ...submitted(['essay.pdf']), isLate: true };
    renderAt(`/assignments/${ASSIGNMENT_ID}`);
    expect(await screen.findByText('Late')).toBeTruthy();
  });

  it('still sees the upload control for an upload that is open and has nothing stored yet', async () => {
    mine = submission({ state: 'UPLOADING', draftVersion: draftOf([]) });
    await openPage();
    expect(screen.queryByRole('heading', { name: 'Your submission' })).toBeNull();
  });

  it('offers Try again when the submission cannot be read, and shows no upload control meanwhile', async () => {
    mineAnswer = () => failure(500, 'INTERNAL');
    renderAt(`/assignments/${ASSIGNMENT_ID}`);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your files' })).toBeNull();
  });
});

describe('when late submissions are closed', () => {
  it('shows Closed and the reason in place of the upload control', async () => {
    mine = submission({ closed: true });
    renderAt(`/assignments/${ASSIGNMENT_ID}`);

    expect(await screen.findByText('Closed')).toBeTruthy();
    expect(screen.getByText('Late submissions are closed for this assignment.')).toBeTruthy();
    expect(screen.queryByLabelText('Add photos or PDF')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your files' })).toBeNull();
  });

  it('still shows the receipt to a student who submitted before it closed', async () => {
    mine = { ...submitted(['essay.pdf']), closed: true };
    renderAt(`/assignments/${ASSIGNMENT_ID}`);

    expect(await screen.findByText('essay.pdf')).toBeTruthy();
    expect(screen.queryByText('Closed')).toBeNull();
  });

  it('shows nothing to upload in an archived class, closed or not', async () => {
    archived = true;
    mine = submission({ closed: true });
    renderAt(`/assignments/${ASSIGNMENT_ID}`);

    await screen.findByText('Archived');
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByLabelText('Add photos or PDF')).toBeNull();
  });
});
