import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError } from './app-error';

// The storage adapter (API Spec C.4). Two implementations: local-storage.ts (development) and supabase-storage.ts.
// Callers get one from create-storage.ts. Buckets are private: a file is reached only through `signedUrl`, after the
// caller has checked who may see it (TRD §7.4). Paths are built from IDs by the caller, never from file names.

export type StoredObject = { size: number; sha256: string };

export type StorageAdapter = {
  /** Stores the bytes, or fails with FILE_TOO_LARGE past `maxBytes` and stores nothing. A path that already exists is replaced. */
  put(bucket: string, path: string, body: Readable, contentType: string, maxBytes: number): Promise<StoredObject>;
  /** Streams an object. For server-side processing only: it is never returned to a client. A missing object is NOT_FOUND. */
  get(bucket: string, path: string): Promise<Readable>;
  /** A link that works for `ttlSeconds`. A missing object is NOT_FOUND. */
  signedUrl(bucket: string, path: string, ttlSeconds?: number): Promise<string>;
  /** A missing object counts as removed. */
  remove(bucket: string, paths: string[]): Promise<void>;
  exists(bucket: string, path: string): Promise<boolean>;
};

/** How long a download link works (TRD §9.3). */
export const SIGNED_URL_SECONDS = 300;

/** Passes the bytes through while counting and hashing them. Past `maxBytes` the stream fails with FILE_TOO_LARGE. */
export function measure(body: Readable, maxBytes: number) {
  const hash = createHash('sha256');
  let size = 0;
  let tooLarge = false;

  async function* chunks() {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        throw new AppError('FILE_TOO_LARGE');
      }
      hash.update(chunk);
      yield chunk;
    }
  }

  return {
    stream: Readable.from(chunks(), { objectMode: false }),
    /** True when the stream stopped for being over the cap, whatever error the writer reported. */
    wasTooLarge: () => tooLarge,
    result: (): StoredObject => ({ size, sha256: hash.digest('hex') }),
  };
}
