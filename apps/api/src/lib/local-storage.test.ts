import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStorage } from './local-storage';

const BUCKET = 'edugemini';
const PATH = 'submissions/c1/a1/s1/v1/1-f1.pdf';
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

let dir: string;
let storage: ReturnType<typeof createLocalStorage>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edugemini-storage-'));
  storage = createLocalStorage({ dir, appUrl: 'http://localhost:5173', secret: 'a-test-secret-of-at-least-32-characters' });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

const bytes = (...parts: string[]) => Readable.from(parts.map((part) => Buffer.from(part)));

describe('local storage', () => {
  it('stores the bytes and reports their size and SHA-256', async () => {
    const stored = await storage.put(BUCKET, PATH, bytes('he', 'llo'), 'application/pdf', 10);
    expect(stored).toEqual({ size: 5, sha256: HELLO_SHA256 });
    expect(await text(await storage.get(BUCKET, PATH))).toBe('hello');
  });

  it('refuses a file over the cap and stores nothing, not even a partial file', async () => {
    await expect(storage.put(BUCKET, PATH, bytes('12345', '678'), 'application/pdf', 5)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await storage.exists(BUCKET, PATH)).toBe(false);
    expect(await readdir(join(dir, BUCKET, 'submissions/c1/a1/s1/v1'))).toEqual([]);
  });

  it('accepts a file exactly at the cap', async () => {
    const stored = await storage.put(BUCKET, PATH, bytes('12345'), 'application/pdf', 5);
    expect(stored.size).toBe(5);
  });

  it('replaces a file stored again at the same path, so a retried upload is harmless', async () => {
    await storage.put(BUCKET, PATH, bytes('first'), 'application/pdf', 10);
    await storage.put(BUCKET, PATH, bytes('second'), 'application/pdf', 10);
    expect(await text(await storage.get(BUCKET, PATH))).toBe('second');
  });

  it('says whether an object exists', async () => {
    expect(await storage.exists(BUCKET, PATH)).toBe(false);
    await storage.put(BUCKET, PATH, bytes('x'), 'application/pdf', 10);
    expect(await storage.exists(BUCKET, PATH)).toBe(true);
  });

  it('gives NOT_FOUND for a missing object, to read or to sign', async () => {
    await expect(storage.get(BUCKET, PATH)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(storage.signedUrl(BUCKET, PATH)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removes objects, and a missing one counts as removed', async () => {
    await storage.put(BUCKET, PATH, bytes('x'), 'application/pdf', 10);
    await storage.remove(BUCKET, [PATH, 'submissions/never-existed.pdf']);
    expect(await storage.exists(BUCKET, PATH)).toBe(false);
    await storage.remove(BUCKET, [PATH]);
  });

  it('never leaves the storage folder, whatever the path says', async () => {
    await expect(storage.put(BUCKET, '../escape.pdf', bytes('x'), 'application/pdf', 10)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(storage.put('../other', 'a.pdf', bytes('x'), 'application/pdf', 10)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(storage.exists(BUCKET, '../../etc/passwd')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('signs a link that lasts five minutes unless told otherwise', async () => {
    await storage.put(BUCKET, PATH, bytes('x'), 'application/pdf', 10);
    const before = Math.floor(Date.now() / 1000);
    const url = new URL(await storage.signedUrl(BUCKET, PATH));
    expect(url.origin + url.pathname).toBe('http://localhost:5173/api/dev/files');
    expect(url.searchParams.get('bucket')).toBe(BUCKET);
    expect(url.searchParams.get('path')).toBe(PATH);
    const expires = Number(url.searchParams.get('expires'));
    expect(expires).toBeGreaterThanOrEqual(before + 300);
    expect(expires).toBeLessThanOrEqual(before + 301);

    const short = new URL(await storage.signedUrl(BUCKET, PATH, 60));
    expect(Number(short.searchParams.get('expires'))).toBeLessThanOrEqual(before + 61);
  });
});
