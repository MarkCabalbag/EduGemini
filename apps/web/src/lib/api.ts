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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** A file sent as it is, with its own type and its name in X-File-Name (API Spec SUB-03). Use instead of `body`. */
  file?: { blob: Blob; name: string };
  /** With `file`: told how much has been sent, in percent, as the upload goes. */
  onProgress?: (percent: number) => void;
};

type Answer = { status: number; data: unknown };

/** A file goes by XMLHttpRequest, because fetch cannot say how much of an upload has been sent. */
function sendFile(url: string, method: string, file: { blob: Blob; name: string }, onProgress?: (percent: number) => void): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.setRequestHeader('Content-Type', file.blob.type || 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let data: unknown;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        // an empty or broken body counts as no data, as with fetch below
      }
      resolve({ status: request.status, data });
    };
    request.onerror = () => reject(new Error('network'));
    request.send(file.blob);
  });
}

async function sendJson(url: string, method: string, body: unknown): Promise<Answer> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: response.status === 204 ? undefined : await response.json().catch(() => undefined) };
}

/** The only place the web app calls fetch (code-standards §8). Same origin: the base is a relative /api. */
export async function api<T = undefined>(path: string, { method = 'GET', body, file, onProgress }: Options = {}): Promise<T> {
  let answer: Answer;
  try {
    answer = file ? await sendFile(`/api${path}`, method, file, onProgress) : await sendJson(`/api${path}`, method, body);
  } catch {
    throw new ApiRequestError('NETWORK', 0);
  }
  const { status, data } = answer;

  if (status === 204) return undefined as T;
  if (status < 200 || status >= 300) {
    const envelope = ErrorEnvelopeSchema.safeParse(data);
    if (envelope.success) {
      const { code, fields, requestId, details } = envelope.data.error;
      throw new ApiRequestError(code, status, fields, requestId, details);
    }
    throw new ApiRequestError('INTERNAL', status);
  }
  return data as T;
}
