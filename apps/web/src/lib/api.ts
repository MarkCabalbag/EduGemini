import { ErrorEnvelopeSchema, type ErrorCode } from '@edugemini/shared';

/** Thrown for every failed call. `code` is the only thing the UI branches on (API Spec A4). */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly status: number,
    readonly fields?: Record<string, string>,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  /** A file sent as it is, with its own type and its name in X-File-Name (API Spec SUB-03). Use instead of `body`. */
  file?: { blob: Blob; name: string };
};

/** The only place the web app calls fetch (code-standards §8). Same origin: the base is a relative /api. */
export async function api<T = undefined>(path: string, { method = 'GET', body, file }: Options = {}): Promise<T> {
  const init: RequestInit = file
    ? {
        method,
        headers: { 'Content-Type': file.blob.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file.blob,
      }
    : {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      };

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiRequestError('NETWORK', 0);
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(data);
    if (envelope.success) {
      const { code, fields, requestId, details } = envelope.data.error;
      throw new ApiRequestError(code, response.status, fields, requestId, details);
    }
    throw new ApiRequestError('INTERNAL', response.status);
  }
  return data as T;
}
