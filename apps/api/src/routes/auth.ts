import type { PrismaClient } from '@prisma/client';
import { Router, type Request } from 'express';
import { SignInSchema, SignUpSchema } from '@edugemini/shared';
import { signIn, signUp } from '../auth/auth-service';
import { cookieOptions, deleteSession, readSessionToken, SESSION_COOKIE } from '../auth/session';
import { limiters } from '../middleware/rate-limit';
import { validate, validated } from '../middleware/validate';

type AuthDeps = { db: PrismaClient; appUrl: string };

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const signUpInput = { body: SignUpSchema };
const signInInput = { body: SignInSchema };

/** Sign up, sign in and sign out (API Spec AUTH-01 to AUTH-03). These need no session, so they run before it is loaded. */
export function authRouter({ db, appUrl }: AuthDeps): Router {
  const router = Router();
  const cookie = cookieOptions(appUrl);

  /**
   * A new sign-in replaces the session the browser already holds, so the old token stops working.
   * Best effort: the sign-in has already succeeded, and a failed cleanup must not turn it into an error.
   */
  const dropHeldSession = async (req: Request) => {
    const held = readSessionToken(req);
    if (!held) return;
    try {
      await deleteSession(db, held);
    } catch (error) {
      req.log.warn({ event: 'session.drop_failed', err: error });
    }
  };

  router.post('/auth/signup', limiters.signUpByIp(), validate(signUpInput), async (req, res) => {
    const { body } = validated(res, signUpInput);
    const { me, token } = await signUp(db, body);
    await dropHeldSession(req);
    res.cookie(SESSION_COOKIE, token, cookie).status(201).json(me);
  });

  router.post(
    '/auth/signin',
    limiters.signInFloodByIp(),
    limiters.authByIp(),
    limiters.signInByEmailAndIp(),
    validate(signInInput),
    async (req, res) => {
      const { body } = validated(res, signInInput);
      const { me, token } = await signIn(db, body, req.log);
      await dropHeldSession(req);
      res.cookie(SESSION_COOKIE, token, cookie).json(me);
    },
  );

  // 204 even with no session or an expired one. If the database fails, the error is returned (not hidden), so the user
  // knows the session may still be open and can sign out again.
  router.post('/auth/signout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) await deleteSession(db, token);
    res
      .clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined })
      .status(204)
      .end();
  });

  return router;
}
