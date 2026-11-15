import type { RequestHandler } from 'express';
import { authorize, type Action } from '../policy/policy';

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
