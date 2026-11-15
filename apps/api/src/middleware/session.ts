import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { findSession, readSessionToken } from '../auth/session';
import { AppError } from '../lib/app-error';

/** Sets `req.auth` when the request carries a valid session. A missing or invalid session is not an error: public routes need none. */
export function loadSession(db: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const token = readSessionToken(req);
    if (token) req.auth = await findSession(db, token);
    next();
  };
}

/** For protected routes. Suspension is read from the database on every request, so it takes effect at once. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new AppError('UNAUTHENTICATED'));
  if (req.auth.user.suspended) return next(new AppError('ACCOUNT_SUSPENDED'));
  next();
};
