import { Router } from 'express';

const HEALTH_TIMEOUT_MS = 3000;

/** GET /healthz (API Spec A8): unauthenticated, outside /api, reveals nothing internal. */
export function healthRouter(checkDb: () => Promise<void>): Router {
  const router = Router();
  router.get('/healthz', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await Promise.race([
        checkDb(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS).unref()),
      ]);
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', time: new Date().toISOString() });
    }
  });
  return router;
}
