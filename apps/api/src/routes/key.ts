import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { SaveKeySchema, type KeyStatus } from '@edugemini/shared';
import type { Env } from '../lib/env';
import { requireAction } from '../middleware/authorize';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import { deleteKey, getKeyInfo, saveKey, type KeyInfo } from '../services/key-service';

type KeyDeps = { db: PrismaClient; env: Pick<Env, 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_VERSION'> };

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const save = { body: SaveKeySchema };
const none = {};

/** `status` is null until the key is checked with Gemini (EG-KEY-03): the column's default means nothing before that. */
const keyStatus = (info: KeyInfo | null): KeyStatus => ({
  connected: info !== null,
  status: null,
  last4: info?.last4 ?? null,
  lastSuccessAt: info?.lastSuccessAt ?? null,
  disclosureAckAt: info?.disclosureAckAt ?? null,
});

/**
 * The instructor's own Gemini key: read its status, save or replace it, remove it (API Spec KEY-01 to KEY-03). The role check
 * comes first, so a student cannot tell the route exists. No route returns the key; only its last four characters leave.
 * It has no limit of its own (API Spec A12), so the general 120 a minute applies. Needs the session, so it is mounted after loadSession.
 */
export function keyRouter({ db, env }: KeyDeps): Router {
  const router = Router();
  router.use('/me/key', requireAuth, requireAction('key.manage'));

  router.get('/me/key', validate(none), async (req, res) => {
    res.json(keyStatus(await getKeyInfo(db, req.auth!.user)));
  });

  router.put('/me/key', validate(save), async (req, res) => {
    const { body } = validated(res, save);
    const ackAt = body.disclosureAcknowledged === true ? new Date() : null;
    res.json(keyStatus(await saveKey(db, env, req.auth!.user, body.apiKey, ackAt)));
  });

  router.delete('/me/key', validate(none), async (req, res) => {
    await deleteKey(db, req.auth!.user);
    res.status(204).end();
  });

  return router;
}
