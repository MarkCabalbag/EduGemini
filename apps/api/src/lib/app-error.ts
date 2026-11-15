import type { ErrorCode } from '@edugemini/shared';

export type AppErrorOptions = {
  /** For logs and developers. The UI looks its text up from `code` (API Spec A4). */
  message?: string;
  /** Field messages keyed by JSON path. Only for VALIDATION and CONFIRMATION_REQUIRED. */
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/** Handlers throw this. The error handler turns it into the response envelope (code-standards §5). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
    this.headers = options.headers;
  }
}
