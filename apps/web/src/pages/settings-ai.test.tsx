// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeyStatus, Me } from '@edugemini/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, renderAt } from '../test/helpers';

// The real pages and routing run. Only the API, which is outside the web app, is replaced by a fake.

const instructor: Me = {
  id: '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Cruz',
  role: 'INSTRUCTOR',
  emailVerified: true,
  suspended: false,
};
const student: Me = { ...instructor, role: 'STUDENT' };

const NO_KEY: KeyStatus = { connected: false, status: null, last4: null, lastSuccessAt: null, disclosureAckAt: null };
const savedKey = (last4: string): KeyStatus => ({ connected: true, status: null, last4, lastSuccessAt: null, disclosureAckAt: '2026-11-16T10:00:00.000Z' });
const API_KEY = 'AIzaSyExampleKeyForTestsOnly1234';

type Call = { path: string; method: string; body?: { apiKey?: string; disclosureAcknowledged?: boolean } };
let calls: Call[];
let me: Me;
let key: KeyStatus;
let saveResult: (body: NonNullable<Call['body']>) => Response;
let removeResult: () => Response;

beforeEach(() => {
  calls = [];
  me = instructor;
  key = NO_KEY;
  // Like the API: saving stores the key and gives back its status.
  saveResult = (body) => {
    key = savedKey(body.apiKey!.slice(-4));
    return Response.json(key);
  };
  removeResult = () => {
    key = NO_KEY;
    return new Response(null, { status: 204 });
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Call['body']) : undefined;
      calls.push({ path, method, body });

      if (path === '/me') return Response.json(me);
      if (path === '/me/key') {
        if (me.role !== 'INSTRUCTOR') return failure(404, 'NOT_FOUND');
        if (method === 'GET') return Response.json(key);
        if (method === 'PUT') return saveResult(body!);
        if (method === 'DELETE') return removeResult();
      }
      return failure(404, 'NOT_FOUND');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (method: string) => calls.filter((c) => c.path === '/me/key' && c.method === method);
const keyBox = () => screen.getByLabelText('Gemini API key') as HTMLInputElement;

describe('Settings > AI, before a key is saved', () => {
  it('says no key is saved, shows the data-use notice and the setup steps with the AI Studio link', async () => {
    renderAt('/settings/ai');

    expect(await screen.findByRole('heading', { name: 'Gemini key' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No key saved' })).toBeTruthy();
    expect(screen.getByText(/sent to Google Gemini under your key/)).toBeTruthy();
    expect(screen.getByLabelText('I understand')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save key' })).toBeTruthy();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /Google AI Studio/ }).getAttribute('href')).toBe('https://aistudio.google.com/docs');
    expect(keyBox().type).toBe('password'); // the key is not shown as it is typed
  });

  it('does not send the key until "I understand" is ticked, then sends it with the acknowledgement', async () => {
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.type(await screen.findByLabelText('Gemini API key'), API_KEY);

    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByText('Tick "I understand" to save your key.')).toBeTruthy();
    expect(sent('PUT')).toHaveLength(0);

    await user.click(screen.getByLabelText('I understand'));
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0]?.body).toEqual({ apiKey: API_KEY, disclosureAcknowledged: true });
  });

  it('after saving shows only the last four characters, empties the box and no longer asks to acknowledge', async () => {
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.type(await screen.findByLabelText('Gemini API key'), `  ${API_KEY} `);
    await user.click(screen.getByLabelText('I understand'));

    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByRole('heading', { name: 'Key saved' })).toBeTruthy();
    expect(screen.getByText('Key saved.')).toBeTruthy();
    expect(screen.getByText(API_KEY.slice(-4))).toBeTruthy();
    expect(document.body.textContent).not.toContain(API_KEY);
    expect(sent('PUT')[0]?.body?.apiKey).toBe(API_KEY); // sent trimmed
    expect(keyBox().value).toBe('');
    expect(screen.queryByLabelText('I understand')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
    expect(screen.getByText('It has not been checked with Google yet.')).toBeTruthy();
  });

  it('refuses a key that is too short in the form, and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.type(await screen.findByLabelText('Gemini API key'), 'short');
    await user.click(screen.getByLabelText('I understand'));

    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByText(/This key looks too short/)).toBeTruthy();
    expect(sent('PUT')).toHaveLength(0);
  });

  it('shows the API\'s reason under the key box when it refuses the key', async () => {
    saveResult = () => failure(400, 'VALIDATION', { apiKey: 'This key looks too long. Check that you copied only the key.' });
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.type(await screen.findByLabelText('Gemini API key'), API_KEY);
    await user.click(screen.getByLabelText('I understand'));

    await user.click(screen.getByRole('button', { name: 'Save key' }));

    expect(await screen.findByText(/This key looks too long/)).toBeTruthy();
    expect(keyBox().value).toBe(API_KEY); // what was typed stays, so it can be corrected
  });
});

describe('Settings > AI, with a key saved', () => {
  beforeEach(() => {
    key = savedKey('wxyz');
  });

  it('shows the last four characters and offers Replace key and Remove key, without the acknowledgement', async () => {
    renderAt('/settings/ai');

    expect(await screen.findByRole('heading', { name: 'Key saved' })).toBeTruthy();
    expect(screen.getByText('wxyz')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeTruthy();
    expect(screen.queryByLabelText('I understand')).toBeNull();
  });

  it('replaces the key with no tick, and shows the new last four', async () => {
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.type(await screen.findByLabelText('Gemini API key'), API_KEY);

    await user.click(screen.getByRole('button', { name: 'Replace key' }));

    expect(await screen.findByText(API_KEY.slice(-4))).toBeTruthy();
    expect(sent('PUT')).toHaveLength(1);
    expect(screen.queryByText('wxyz')).toBeNull();
  });

  it('asks before removing, sends nothing on Cancel, and removes the key on confirm', async () => {
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.click(await screen.findByRole('button', { name: 'Remove key' }));

    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove your Gemini key?')).toBeTruthy();
    expect(within(dialog).getByText(/AI grading stops for all your assignments/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent('DELETE')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove key' }));

    expect(await screen.findByRole('heading', { name: 'No key saved' })).toBeTruthy();
    expect(sent('DELETE')).toHaveLength(1);
    expect(screen.getByText('Key removed. AI grading is off until you add a key.')).toBeTruthy();
    expect(screen.getByLabelText('I understand')).toBeTruthy(); // the next save is a first save again
  });

  it('says why when the key could not be removed, and keeps it', async () => {
    removeResult = () => failure(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt('/settings/ai');
    await user.click(await screen.findByRole('button', { name: 'Remove key' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove key' }));

    expect(await screen.findByText('Something went wrong on our side.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Key saved' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('who sees Settings > AI', () => {
  it('shows an instructor a Settings link in the header', async () => {
    renderAt('/classes');

    const link = await screen.findByRole('link', { name: 'Settings' });
    expect(link.getAttribute('href')).toBe('/settings/ai');
  });

  it('gives a student the not-found page, with no Settings link and no request for the key', async () => {
    me = student;
    renderAt('/settings/ai');

    expect(await screen.findByText(/couldn.t find that page/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(calls.some((c) => c.path === '/me/key')).toBe(false);
  });
});
