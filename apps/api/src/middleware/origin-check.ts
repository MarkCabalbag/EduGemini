import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence with SameSite=Lax cookies (TRD §6.5): every non-GET request must carry an Origin equal to APP_URL.
 * Runs before the body is read (API Spec A3).
 */
export function originCheck(appUrl: string): RequestHandler {
  const allowed = new URL(appUrl).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get('origin') !== allowed) return next(new AppError('CSRF_ORIGIN', { message: 'Missing or foreign Origin' }));
    next();
  };
}
