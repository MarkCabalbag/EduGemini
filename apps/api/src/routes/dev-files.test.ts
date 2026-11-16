import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createLocalStorage } from '../lib/local-storage';
import { createLogger } from '../lib/logger';
import { unusedDb } from '../test/unused-db';
import { devFilesRouter } from './dev-files';

const APP_URL = 'http://localhost:5173';
const SECRET = 'a-test-secret-of-at-least-32-characters';
const BUCKET = 'edugemini';

let dir: string;
let storage: ReturnType<typeof createLocalStorage>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edugemini-dev-files-'));
  storage = createLocalStorage({ dir, appUrl: APP_URL, secret: SECRET });
  app = createApp({
    env: { APP_URL },
    logger: createLogger('silent', 'test'),
    db: unusedDb,
    checkDb: async () => {},
    routers: [devFilesRouter({ dir, secret: SECRET })],
  });
  await storage.put(BUCKET, 'submissions/a.pdf', Readable.from([Buffer.from('%PDF-one')]), 'application/pdf', 100);
  await storage.put(BUCKET, 'submissions/b.pdf', Readable.from([Buffer.from('%PDF-two')]), 'application/pdf', 100);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The link as the browser sends it: the path and query of the signed URL. */
const open = (url: string) => {
  const { pathname, search } = new URL(url);
  return request(app).get(pathname + search);
};

describe('GET /api/dev/files', () => {
  it('serves the file for a link signed by the local storage', async () => {
    const res = await open(await storage.signedUrl(BUCKET, 'submissions/a.pdf'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.body.toString()).toBe('%PDF-one');
  });

  it('is NOT_FOUND once the link has expired', async () => {
    const res = await open(await storage.signedUrl(BUCKET, 'submissions/a.pdf', -1));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('is NOT_FOUND when the signature is changed', async () => {
    const url = new URL(await storage.signedUrl(BUCKET, 'submissions/a.pdf'));
    url.searchParams.set('sig', 'f'.repeat(64));
    expect((await open(url.toString())).status).toBe(404);
  });

  it('is NOT_FOUND when the link is moved to another file', async () => {
    const url = new URL(await storage.signedUrl(BUCKET, 'submissions/a.pdf'));
    url.searchParams.set('path', 'submissions/b.pdf');
    expect((await open(url.toString())).status).toBe(404);
  });

  it('is NOT_FOUND when the file was removed after the link was signed', async () => {
    const url = await storage.signedUrl(BUCKET, 'submissions/a.pdf');
    await storage.remove(BUCKET, ['submissions/a.pdf']);
    expect((await open(url)).status).toBe(404);
  });

  it('refuses a request with no signature', async () => {
    const res = await request(app).get('/api/dev/files').query({ bucket: BUCKET, path: 'submissions/a.pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
