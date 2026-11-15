import { afterEach, describe, expect, it, vi } from 'vitest';
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
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await api('/x').catch((e: unknown) => e)).toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
