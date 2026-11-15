import type { PrismaClient } from '@prisma/client';
import { Router, type Request } from 'express';
import { SignInSchema, SignUpSchema } from '@edugemini/shared';
import { signIn, signUp } from '../auth/auth-service';
import { cookieOptions, deleteSession, readSessionToken, SESSION_COOKIE } from '../auth/session';
import { limiters } from '../middleware/rate-limit';
import { validate, validated } from '../middleware/validate';

type AuthDeps = { db: PrismaClient; appUrl: string };

/** Sign up, sign in and sign out (API Spec AUTH-01 to AUTH-03). These need no session, so they run before it is loaded. */
export function authRouter({ db, appUrl }: AuthDeps): Router {
  const router = Router();
  const cookie = cookieOptions(appUrl);

  /** A new sign-in replaces the session the browser already holds, so the old token stops working. */
  const dropHeldSession = async (req: Request) => {
    const held = readSessionToken(req);
    if (held) await deleteSession(db, held);
  };

  router.post('/auth/signup', limiters.signUpByIp(), validate({ body: SignUpSchema }), async (req, res) => {
    const { body } = validated(res, { body: SignUpSchema });
    const { me, token } = await signUp(db, body);
    await dropHeldSession(req);
    res.cookie(SESSION_COOKIE, token, cookie).status(201).json(me);
  });

  router.post(
    '/auth/signin',
    limiters.signInFloodByIp(),
    limiters.authByIp(),
    limiters.signInByEmail(),
    validate({ body: SignInSchema }),
    async (req, res) => {
      const { body } = validated(res, { body: SignInSchema });
      const { me, token } = await signIn(db, body);
      await dropHeldSession(req);
      res.cookie(SESSION_COOKIE, token, cookie).json(me);
    },
  );

  // Always 204, even with no session or an expired one.
  router.post('/auth/signout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) await deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined }).status(204).end();
  });

  return router;
}
