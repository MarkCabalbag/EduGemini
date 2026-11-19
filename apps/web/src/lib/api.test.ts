import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr } from '../test/fake-xhr';
import { api, ApiRequestError } from './api';

function respond(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () => (body === undefined ? new Response(null, { status }) : Response.json(body, { status })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('returns the JSON body, and sends JSON with a relative /api path', async () => {
    respond(200, { id: '1' });
    expect(await api('/me')).toEqual({ id: '1' });

    const fetchMock = respond(201, { ok: true });
    await api('/auth/signin', { method: 'POST', body: { email: 'a@b.co' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/signin');
    expect(init).toMatchObject({ method: 'POST', body: '{"email":"a@b.co"}', headers: { 'Content-Type': 'application/json' } });
  });

  it('returns undefined for 204', async () => {
    respond(204);
    expect(await api('/auth/signout', { method: 'POST' })).toBeUndefined();
  });

  it('turns the error envelope into an ApiRequestError with its code, fields and request ID', async () => {
    respond(400, { error: { code: 'VALIDATION', message: 'x', requestId: 'r1', fields: { password: 'Too short' } } });
    const error = await api('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'VALIDATION', status: 400, fields: { password: 'Too short' }, requestId: 'r1' });
  });

  it('treats an unreadable error response as INTERNAL', async () => {
    respond(502);
    expect(await api('/x').catch((e: unknown) => e)).toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('reports a dropped connection as NETWORK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await api('/x').catch((e: unknown) => e)).toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('sends DELETE with no body', async () => {
    const fetchMock = respond(204);
    expect(await api('/versions/v/files/f', { method: 'DELETE' })).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/versions/v/files/f');
    expect(init).toMatchObject({ method: 'DELETE', body: undefined });
  });
});

describe('api, sending a file', () => {
  const blob = new Blob(['abcd'], { type: 'application/pdf' });

  it('sends the bytes as they are with the type and the URL-encoded name, tells how much went, and returns the JSON', async () => {
    const fetchMock = respond(201, { id: 'file-1' });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: number[] = [];

    const answer = await api('/versions/v/files/f', {
      method: 'PUT',
      file: { blob, name: 'My essay.pdf' },
      onProgress: (percent) => progress.push(percent),
    });

    expect(answer).toEqual({ id: 'file-1' });
    expect(progress).toEqual([50]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/versions/v/files/f');
    expect(init).toMatchObject({
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'My%20essay.pdf' },
    });
  });

  it('turns an error answer into an ApiRequestError, and a dropped connection into NETWORK', async () => {
    respond(413, { error: { code: 'FILE_TOO_LARGE', message: 'x', requestId: 'r2' } });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    expect(await api('/x', { method: 'PUT', file: { blob, name: 'a.pdf' } }).catch((e: unknown) => e)).toMatchObject({
      code: 'FILE_TOO_LARGE',
      status: 413,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await api('/x', { method: 'PUT', file: { blob, name: 'a.pdf' } }).catch((e: unknown) => e)).toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
  });
});
