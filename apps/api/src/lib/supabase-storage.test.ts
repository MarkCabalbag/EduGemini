import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseStorage } from './supabase-storage';

// Supabase is an outside service, so `fetch` is replaced (code-standards §12). These tests pin what we send and how
// each answer is read; they cannot show that Supabase agrees. That is checked against the real service (API Spec C.4 "verify").

const KEY = 'service-role-key-for-tests';
const BUCKET = 'edugemini';
const PATH = 'submissions/c1/a1/s1/v1/1-f1.pdf';
const OBJECT_URL = `https://abc.supabase.co/storage/v1/object/${BUCKET}/${PATH}`;
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const fetchMock = vi.fn<typeof fetch>();
const storage = createSupabaseStorage({ url: 'https://abc.supabase.co', serviceRoleKey: KEY });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

/** Reads a request body the way the network would. */
async function drain(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

const bytes = (...parts: string[]) => Readable.from(parts.map((part) => Buffer.from(part)));

describe('supabase storage: put', () => {
  it('streams the bytes to the object URL with the service-role key, and reports size and SHA-256', async () => {
    let sent = '';
    fetchMock.mockImplementation(async (_url, init) => {
      sent = await drain(init?.body);
      return Response.json({ Key: `${BUCKET}/${PATH}` });
    });

    const stored = await storage.put(BUCKET, PATH, bytes('he', 'llo'), 'application/pdf', 10);

    expect(stored).toEqual({ size: 5, sha256: HELLO_SHA256 });
    expect(sent).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(OBJECT_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true', // a retried upload of the same file replaces it
    });
  });

  it('refuses a file over the cap with FILE_TOO_LARGE', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      await drain(init?.body);
      return Response.json({});
    });
    await expect(storage.put(BUCKET, PATH, bytes('12345', '678'), 'application/pdf', 5)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('refuses a file over the cap even when fetch reports only a failed request', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      await drain(init?.body).catch(() => undefined);
      throw new TypeError('fetch failed');
    });
    await expect(storage.put(BUCKET, PATH, bytes('12345', '678'), 'application/pdf', 5)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('is SERVICE_UNAVAILABLE for storage when Supabase answers with an error', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      await drain(init?.body);
      return new Response('{"message":"secret internals"}', { status: 500 });
    });
    const failure = await storage.put(BUCKET, PATH, bytes('hello'), 'application/pdf', 10).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { service: 'storage' } });
    expect(JSON.stringify(failure)).not.toContain('secret internals');
  });

  it('is SERVICE_UNAVAILABLE when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(storage.put(BUCKET, PATH, bytes('hello'), 'application/pdf', 10)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('supabase storage: get', () => {
  it('streams the object', async () => {
    fetchMock.mockResolvedValue(new Response('hello'));
    expect(await drain(await storage.get(BUCKET, PATH))).toBe('hello');
    expect(fetchMock.mock.calls[0]![0]).toBe(OBJECT_URL);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('GET');
  });

  it('gives NOT_FOUND for a missing object', async () => {
    fetchMock.mockResolvedValue(Response.json({ statusCode: '404', error: 'not_found' }, { status: 400 }));
    await expect(storage.get(BUCKET, PATH)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is SERVICE_UNAVAILABLE on a server error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    await expect(storage.get(BUCKET, PATH)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('supabase storage: signedUrl', () => {
  it('asks for five minutes by default and returns the full link', async () => {
    fetchMock.mockResolvedValue(Response.json({ signedURL: `/object/sign/${BUCKET}/${PATH}?token=abc` }));

    const url = await storage.signedUrl(BUCKET, PATH);

    expect(url).toBe(`https://abc.supabase.co/storage/v1/object/sign/${BUCKET}/${PATH}?token=abc`);
    const [requested, init] = fetchMock.mock.calls[0]!;
    expect(requested).toBe(`https://abc.supabase.co/storage/v1/object/sign/${BUCKET}/${PATH}`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ expiresIn: 300 });
  });

  it('passes another lifetime on', async () => {
    fetchMock.mockResolvedValue(Response.json({ signedURL: '/object/sign/x?token=t' }));
    await storage.signedUrl(BUCKET, PATH, 60);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ expiresIn: 60 });
  });

  it('gives NOT_FOUND for a missing object', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 400 }));
    await expect(storage.signedUrl(BUCKET, PATH)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is SERVICE_UNAVAILABLE when the answer has no link', async () => {
    fetchMock.mockResolvedValue(Response.json({ unexpected: true }));
    await expect(storage.signedUrl(BUCKET, PATH)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('supabase storage: remove and exists', () => {
  it('removes the listed objects in one request', async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    await storage.remove(BUCKET, [PATH, 'submissions/gone.pdf']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://abc.supabase.co/storage/v1/object/${BUCKET}`);
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ prefixes: [PATH, 'submissions/gone.pdf'] });
  });

  it('sends nothing when there is nothing to remove', async () => {
    await storage.remove(BUCKET, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is SERVICE_UNAVAILABLE when the removal fails, so the outbox row stays and is tried again', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    await expect(storage.remove(BUCKET, [PATH])).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('says whether an object exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await storage.exists(BUCKET, PATH)).toBe(true);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('HEAD');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await storage.exists(BUCKET, PATH)).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    expect(await storage.exists(BUCKET, PATH)).toBe(false);
  });

  it('does not take an outage for a missing object', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(storage.exists(BUCKET, PATH)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('supabase storage: paths', () => {
  it('encodes each part of the path and keeps the slashes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await storage.exists('my bucket', 'a b/c#d.pdf');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://abc.supabase.co/storage/v1/object/my%20bucket/a%20b/c%23d.pdf');
  });
});
