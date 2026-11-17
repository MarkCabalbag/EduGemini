import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { JoinLinkParamsSchema } from '@edugemini/shared';
import { refuseInstructor } from '../middleware/authorize';
import { limiters } from '../middleware/rate-limit';
import { validate, validated } from '../middleware/validate';
import { previewJoin } from '../services/join-service';

const preview = { params: JoinLinkParamsSchema };

/**
 * What a join link shows (API Spec JOIN-02). A signed-out visitor may use it, so there is no requireAuth: req.auth is set
 * only when they are signed in. It is mounted after the session loads but BEFORE the general limit, because it has an A12
 * row of its own, and a class opens the same link together on one network. Only failed tries count against that row.
 */
export function joinLinkRouter({ db }: { db: PrismaClient }): Router {
  const router = Router();

  router.get('/join/:code', refuseInstructor, validate(preview), limiters.joinPreviewByIp(), async (_req, res) => {
    const { params } = validated(res, preview);
    res.json(await previewJoin(db, params.code));
  });

  return router;
}
