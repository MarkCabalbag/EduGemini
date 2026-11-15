import { ErrorEnvelopeSchema, type ErrorCode } from '@edugemini/shared';

/** Thrown for every failed call. `code` is the only thing the UI branches on (API Spec A4). */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly status: number,
    readonly fields?: Record<string, string>,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

type Options = { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown };

/** The only place the web app calls fetch (code-standards §8). Same origin: the base is a relative /api. */
export async function api<T = undefined>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('NETWORK', 0);
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(data);
    if (envelope.success) {
      const { code, fields, requestId } = envelope.data.error;
      throw new ApiRequestError(code, response.status, fields, requestId);
    }
    throw new ApiRequestError('INTERNAL', response.status);
  }
  return data as T;
}
