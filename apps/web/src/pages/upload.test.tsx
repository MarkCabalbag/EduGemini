// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentDetail, ClassSummary, Me } from '@edugemini/shared';
import { LIMITS } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const callsTo = (method: string, pathStart: string) => calls.filter((c) => c.method === method && c.path.startsWith(pathStart));
const input = () => screen.getByLabelText('Add photos or PDF');
const fileView = (ordinal = 1) => ({ id: crypto.randomUUID(), ordinal, displayName: 'x', mimeType: 'application/pdf', sizeBytes: 8, pageCount: null, status: 'STORED', failureCode: null });
const version = { id: VERSION_ID, versionNo: 1, status: 'UPLOADING', createdAt: '2026-11-16T01:00:00.000Z', storedAt: null };

beforeEach(() => {
  calls = [];
  archived = false;
  openUpload = () => Response.json(version, { status: 201 });
  sendFile = () => Response.json(fileView(), { status: 201 });

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
      if (method === 'POST' && path === `/assignments/${ASSIGNMENT_ID}/versions`) return openUpload();
      if (method === 'PUT' && path.startsWith(`/versions/${VERSION_ID}/files/`)) return sendFile(call);
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
    expect(screen.getByText('PDF, JPG or PNG. Up to 10 files, 10 MB each.')).toBeTruthy();
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

  it('shows the reason when the server refuses the file, with no Retry', async () => {
    sendFile = () => failure(422, 'FILE_LIMIT', undefined, { limit: 'files' });
    await openPage();
    await userEvent.upload(input(), pdf());

    expect(await screen.findByText('You can upload up to 10 files.')).toBeTruthy();
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
