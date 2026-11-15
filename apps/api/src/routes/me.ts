import { Router } from 'express';
import { requireAuth } from '../middleware/session';

/** The signed-in user (API Spec ACC-01). Needs the session, so it is mounted after loadSession. */
export function meRouter(): Router {
  const router = Router();
  router.get('/me', requireAuth, (req, res) => {
    res.json(req.auth?.user);
  });
  return router;
}
