import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ERROR_STATUS, type ErrorEnvelope } from '@edugemini/shared';
import { AppError } from '../lib/app-error';

type HttpError = Error & { type?: string; status?: number };

/** Maps anything thrown to an AppError. Unknown failures become INTERNAL and never leak their detail. */
function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as HttpError;
  if (e?.type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE');
  if (e?.type === 'entity.parse.failed') {
    return new AppError('VALIDATION', { message: 'Malformed JSON', fields: { body: 'Malformed JSON' } });
  }
  return new AppError('INTERNAL');
}

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError('NOT_FOUND'));

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const appError = toAppError(err);
  if (appError.code === 'INTERNAL') {
    // The only place a stack trace goes: the server log, never the response (code-standards §5).
    req.log.error({ event: 'http.unhandled_error', err });
  }

  const body: ErrorEnvelope = {
    error: {
      code: appError.code,
      message: appError.code === 'INTERNAL' ? 'Internal error' : appError.message,
      requestId: req.id,
      ...(appError.fields ? { fields: appError.fields } : {}),
      ...(appError.details ? { details: appError.details } : {}),
    },
  };
  if (appError.headers) res.set(appError.headers);
  res.status(ERROR_STATUS[appError.code]).json(body);
};
