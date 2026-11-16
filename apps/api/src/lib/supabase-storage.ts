import { Readable } from 'node:stream';
import { z } from 'zod';
import { AppError } from './app-error';
import { measure, SIGNED_URL_SECONDS, type StorageAdapter } from './storage';

// Supabase Storage over its REST API with the service-role key, which only the API holds (TRD §7.4, API Spec C.4).
// Plain fetch, so no new library. Buckets must already exist and be private.

export type SupabaseStorageOptions = { url: string; serviceRoleKey: string };

const TIMEOUT_MS = 30_000; // per operation (API Spec C.4)
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SignedUrlResponseSchema = z.object({ signedURL: z.string() });

export function createSupabaseStorage({ url, serviceRoleKey }: SupabaseStorageOptions): StorageAdapter {
  const base = new URL('/storage/v1', url).href;
  const unavailable = () => new AppError('SERVICE_UNAVAILABLE', { details: { service: 'storage' } });
  const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');
  const object = (bucket: string, path: string) => `${encodeURIComponent(bucket)}/${encode(path)}`;
  // Storage answers 400 or 404 for an object that is not there.
  const isMissing = (res: Response) => res.status === 400 || res.status === 404;

  /** One request. A network failure or a timeout is SERVICE_UNAVAILABLE; what a status means is up to the caller. */
  async function send(
    method: string,
    route: string,
    init: Omit<RequestInit, 'method' | 'headers' | 'signal'> & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    try {
      return await fetch(`${base}${route}`, {
        ...init,
        method,
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unavailable();
    }
  }

  return {
    async put(bucket, path, body, contentType, maxBytes) {
      const measured = measure(body, maxBytes);
      // A stream can be read once, so `put` does not retry: the caller still holds the temporary file and may call it again.
      const res = await send('POST', `/object/${object(bucket, path)}`, {
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
        body: Readable.toWeb(measured.stream),
        duplex: 'half',
      }).catch((error: unknown) => {
        if (measured.wasTooLarge()) throw new AppError('FILE_TOO_LARGE'); // fetch reports it as a failed request
        throw error;
      });
      if (!res.ok) throw unavailable();
      return measured.result();
    },

    async get(bucket, path) {
      const res = await send('GET', `/object/${object(bucket, path)}`);
      if (isMissing(res)) throw new AppError('NOT_FOUND');
      if (!res.ok || !res.body) throw unavailable();
      return Readable.fromWeb(res.body);
    },

    async signedUrl(bucket, path, ttlSeconds = SIGNED_URL_SECONDS) {
      const res = await send('POST', `/object/sign/${object(bucket, path)}`, {
        headers: JSON_HEADERS,
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      });
      if (isMissing(res)) throw new AppError('NOT_FOUND');
      if (!res.ok) throw unavailable();
      const parsed = SignedUrlResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw unavailable();
      return `${base}${parsed.data.signedURL}`;
    },

    async remove(bucket, paths) {
      if (paths.length === 0) return;
      // Storage leaves out the objects it does not have and still answers 200, so a missing object counts as removed.
      const res = await send('DELETE', `/object/${encodeURIComponent(bucket)}`, {
        headers: JSON_HEADERS,
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) throw unavailable();
    },

    async exists(bucket, path) {
      const res = await send('HEAD', `/object/${object(bucket, path)}`);
      if (isMissing(res)) return false;
      if (!res.ok) throw unavailable();
      return true;
    },
  };
}
