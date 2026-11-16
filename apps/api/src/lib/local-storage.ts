import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from './app-error';
import { measure, SIGNED_URL_SECONDS, type StorageAdapter } from './storage';

// The development storage: files under STORAGE_LOCAL_DIR. A "signed URL" points at the dev route in
// routes/dev-files.ts, which checks the signature and the expiry (API Spec C.4).

export type LocalStorageOptions = {
  dir: string;
  /** The web app's address; its `/api` proxy reaches the API. */
  appUrl: string;
  /** Signs the links. */
  secret: string;
};

/** Where an object lives on disk. A bucket or path that would leave its folder is NOT_FOUND. */
export function localFilePath(dir: string, bucket: string, path: string): string {
  const root = resolve(dir);
  const bucketDir = resolve(root, bucket);
  const file = resolve(bucketDir, path);
  if (!bucketDir.startsWith(root + sep) || !file.startsWith(bucketDir + sep)) throw new AppError('NOT_FOUND');
  return file;
}

export function localSignature(secret: string, bucket: string, path: string, expires: number): string {
  return createHmac('sha256', secret).update(`${bucket}\n${path}\n${expires}`).digest('hex');
}

export function createLocalStorage({ dir, appUrl, secret }: LocalStorageOptions): StorageAdapter {
  const exists: StorageAdapter['exists'] = async (bucket, path) =>
    stat(localFilePath(dir, bucket, path)).then(
      (info) => info.isFile(),
      () => false,
    );

  return {
    async put(bucket, path, body, _contentType, maxBytes) {
      const file = localFilePath(dir, bucket, path);
      const temp = `${file}.${randomUUID()}.part`; // written aside, then moved in, so nothing is stored partially
      const measured = measure(body, maxBytes);
      await mkdir(dirname(file), { recursive: true });
      try {
        await pipeline(measured.stream, createWriteStream(temp));
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return measured.result();
    },

    async get(bucket, path) {
      if (!(await exists(bucket, path))) throw new AppError('NOT_FOUND');
      return createReadStream(localFilePath(dir, bucket, path));
    },

    async signedUrl(bucket, path, ttlSeconds = SIGNED_URL_SECONDS) {
      if (!(await exists(bucket, path))) throw new AppError('NOT_FOUND'); // Supabase refuses to sign a missing object too
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      const url = new URL('/api/dev/files', appUrl);
      url.search = new URLSearchParams({
        bucket,
        path,
        expires: String(expires),
        sig: localSignature(secret, bucket, path, expires),
      }).toString();
      return url.toString();
    },

    async remove(bucket, paths) {
      for (const path of paths) await rm(localFilePath(dir, bucket, path), { force: true });
    },

    exists,
  };
}
