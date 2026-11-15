import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error';
import { authorize, type Action } from '../policy/policy';

/**
 * For the two join routes (API Spec JOIN-01, JOIN-02): a signed-in instructor is told they cannot join (403) instead of
 * getting NOT_FOUND. This only chooses the message; the policy still decides who may join. Signed-out visitors pass.
 */
export const refuseInstructor: RequestHandler = (req, _res, next) =>
  next(req.auth?.user.role === 'INSTRUCTOR' ? new AppError('INSTRUCTOR_CANNOT_JOIN') : undefined);

/**
 * For an action that needs no resource, placed after `requireAuth` and before validation and rate limits. A role that
 * may not use the route gets NOT_FOUND whatever it sends, so it cannot tell the route exists (API Spec A3).
 */
export const requireAction =
  (action: Action): RequestHandler =>
  (req, _res, next) => {
    authorize(req.auth!.user, action); // requireAuth has run, so there is a session
    next();
  };
