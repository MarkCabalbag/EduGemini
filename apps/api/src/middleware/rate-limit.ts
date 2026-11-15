import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/app-error';

/**
 * Rate limits (TRD §6.7).
 *
 * Counters live in this process's memory, so they are correct for ONE API instance only (TRD §3).
 * Scaling out means moving them to Postgres first. A restart clears them, which is acceptable at this scale.
 */
export type Rule = { windowMs: number; limit: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RULES = {
  /** Sign-in and sign-up, per IP. */
  authByIp: { windowMs: 15 * MINUTE, limit: 20 },
  /** Sign-in, per email, then "try again later" (app-flow §1, step 4). */
  signInByEmail: { windowMs: 15 * MINUTE, limit: 5 },
  /** Password reset request, per email. */
  resetByEmail: { windowMs: HOUR, limit: 3 },
  /** Join-code attempts, per user (FR-CLS-03). */
  joinByUser: { windowMs: HOUR, limit: 10 },
  /** File uploads, per user. */
  uploadByUser: { windowMs: MINUTE, limit: 60 },
} as const satisfies Record<string, Rule>;

type KeyOf = (req: Request) => string;

/** Builds a limiter. Over the limit, it throws RATE_LIMITED with Retry-After, and the error handler answers. */
export function limit(rule: Rule, keyOf: KeyOf): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-6', // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (API Spec A2)
    legacyHeaders: false,
    keyGenerator: keyOf,
    handler: (_req, res, next) => {
      // The library has already set RateLimit-Reset (seconds until the window resets).
      const reset = Number(res.getHeader('RateLimit-Reset'));
      const retryAfter = Number.isFinite(reset) && reset > 0 ? Math.ceil(reset) : Math.ceil(rule.windowMs / 1000);
      next(new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(retryAfter) } }));
    },
  });
}

const byIp: KeyOf = (req) => ipKeyGenerator(req.ip ?? '');

/** The email in a JSON body, lower-cased. Falls back to the IP so a missing email is still limited. */
const byEmail: KeyOf = (req) => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() ? `email:${email.trim().toLowerCase()}` : byIp(req);
};

/** Limit per signed-in user. `userId` comes from the session (AUTH-02). Falls back to the IP when signed out. */
const byUser =
  (userId: (req: Request) => string | undefined): KeyOf =>
  (req) => {
    const id = userId(req);
    return id ? `user:${id}` : byIp(req);
  };

export const limiters = {
  authByIp: () => limit(RULES.authByIp, byIp),
  signInByEmail: () => limit(RULES.signInByEmail, byEmail),
  resetByEmail: () => limit(RULES.resetByEmail, byEmail),
  joinByUser: (userId: (req: Request) => string | undefined) => limit(RULES.joinByUser, byUser(userId)),
  uploadByUser: (userId: (req: Request) => string | undefined) => limit(RULES.uploadByUser, byUser(userId)),
};
