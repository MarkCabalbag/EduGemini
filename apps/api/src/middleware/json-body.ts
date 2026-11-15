import express, { type RequestHandler } from 'express';
import { AppError } from '../lib/app-error';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const JSON_BODY_LIMIT = '100kb';

/** JSON endpoints require application/json and a body of at most 100 KB (API Spec A2). */
export function jsonBody(): RequestHandler[] {
  const requireJson: RequestHandler = (req, _res, next) => {
    // req.is() is null when there is no body, false when the type does not match.
    if (BODY_METHODS.has(req.method) && req.is('application/json') === false) {
      return next(new AppError('UNSUPPORTED_MEDIA_TYPE', { message: 'Content-Type must be application/json' }));
    }
    next();
  };
  return [requireJson, express.json({ limit: JSON_BODY_LIMIT })];
}
