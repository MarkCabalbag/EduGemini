import { Readable } from 'node:stream';
import { AppError } from '../lib/app-error';
import { measure, SIGNED_URL_SECONDS, type StorageAdapter } from '../lib/storage';

/** The storage adapter for tests: objects live in memory, so no disk, no network and no bucket (API Spec C.4). `count` says how many are held. */
export type MemoryStorage = StorageAdapter & { count: () => number };

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, Buffer>();
  const keyOf = (bucket: string, path: string) => `${bucket}/${path}`;

  return {
    async put(bucket, path, body, _contentType, maxBytes) {
      const measured = measure(body, maxBytes);
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of measured.stream) chunks.push(chunk as Buffer);
      } catch (error) {
        if (measured.wasTooLarge()) throw new AppError('FILE_TOO_LARGE'); // nothing is stored
        throw error;
      }
      objects.set(keyOf(bucket, path), Buffer.concat(chunks));
      return measured.result();
    },

    async get(bucket, path) {
      const bytes = objects.get(keyOf(bucket, path));
      if (!bytes) throw new AppError('NOT_FOUND');
      return Readable.from([bytes]);
    },

    async signedUrl(bucket, path, ttlSeconds = SIGNED_URL_SECONDS) {
      if (!objects.has(keyOf(bucket, path))) throw new AppError('NOT_FOUND');
      return `https://storage.test/${bucket}/${path}?expiresIn=${ttlSeconds}`;
    },

    async remove(bucket, paths) {
      for (const path of paths) objects.delete(keyOf(bucket, path)); // a missing object counts as removed
    },

    async exists(bucket, path) {
      return objects.has(keyOf(bucket, path));
    },

    count: () => objects.size,
  };
}
