import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from './create-storage';

const base = {
  STORAGE_LOCAL_DIR: '.storage',
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: 'a-test-secret-of-at-least-32-characters',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createStorage', () => {
  it('gives the local storage for STORAGE_DRIVER=local', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edugemini-create-storage-'));
    try {
      const storage = createStorage({ ...base, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: dir, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
      await storage.put('b', 'a.pdf', Readable.from([Buffer.from('x')]), 'application/pdf', 10);
      expect(await storage.exists('b', 'a.pdf')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('gives the Supabase storage for STORAGE_DRIVER=supabase', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const storage = createStorage({ ...base, STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    await storage.exists('b', 'a.pdf');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://abc.supabase.co/storage/v1/object/b/a.pdf');
  });

  it('refuses the Supabase driver without its URL and key', () => {
    expect(() =>
      createStorage({ ...base, STORAGE_DRIVER: 'supabase', SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }),
    ).toThrow('SUPABASE_URL');
  });
});
