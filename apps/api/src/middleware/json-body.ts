import express, { type RequestHandler } from 'express';
import { AppError } from '../lib/app-error';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const JSON_BODY_LIMIT = '100kb';

/** JSON endpoints require application/json and a body of at most 100 KB (API Spec A2). */
export function jsonBody(): RequestHandler[] {
  const requireJson: RequestHandler = (req, _res, next) => {
    // An empty body (Content-Length: 0, as sent by a plain POST with no data) needs no content type.
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
    if (BODY_METHODS.has(req.method) && hasBody && !req.is('application/json')) {
      return next(new AppError('UNSUPPORTED_MEDIA_TYPE', { message: 'Content-Type must be application/json' }));
    }
    next();
  };
  return [requireJson, express.json({ limit: JSON_BODY_LIMIT })];
}
