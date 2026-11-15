import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { MAX_EMAIL_LENGTH } from '@edugemini/shared';
import { AppError } from '../lib/app-error';

// Rate limits (numbers: API Spec A12). Counters live in this process's memory, so they are correct for ONE API instance only
// (TRD §3). Scaling out means moving them to Postgres first. A restart clears them, which is fine at this scale.
// Limits for join, reset and upload are added with those features. Every route behind the session is covered by
// `everythingElseByUser`, mounted once in createApp (code-standards §5). A route whose own A12 row is higher than 120 a
// minute (notifications, 300) must be excluded from it when that route is added.

type Rule = { windowMs: number; limit: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RULES = {
  /** Sign-in attempts of any kind, per IP. Caps the CPU spent on password checks (argon2 is deliberately slow). */
  signInFloodByIp: { windowMs: 15 * MINUTE, limit: 300 },
  /** Failed sign-ins, per IP. Successful sign-ins do not count, so a class on one network is not blocked. */
  authByIp: { windowMs: 15 * MINUTE, limit: 20 },
  /** Sign-up, per IP (API Spec AUTH-01). Sized for a class signing up together. */
  signUpByIp: { windowMs: HOUR, limit: 60 },
  /** Failed sign-ins, per email and IP together, so a stranger cannot lock the real owner out. */
  signInByEmailAndIp: { windowMs: 15 * MINUTE, limit: 5 },
  /** Class creation, per signed-in user (API Spec CLS-02). It sits after validation, so a form with errors does not use it up. */
  classCreateByUser: { windowMs: HOUR, limit: 20 },
  /** Every route behind the session, per user (API Spec A12, "everything else"). */
  everythingElseByUser: { windowMs: MINUTE, limit: 120 },
} as const satisfies Record<string, Rule>;

type KeyOf = (req: Request) => string;

/** Over the limit it answers 429 RATE_LIMITED. The library has already set Retry-After and the RateLimit-* headers. */
export function limit(rule: Rule, keyOf: KeyOf, options: { countOnlyFailures?: boolean } = {}): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-6', // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (API Spec A2)
    legacyHeaders: false,
    keyGenerator: keyOf,
    skipSuccessfulRequests: options.countOnlyFailures ?? false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
}

const byIp: KeyOf = (req) => ipKeyGenerator(req.ip ?? '');

/**
 * The email in a JSON body (lower-cased, cut to the longest email the schema accepts so a huge value cannot fill memory)
 * together with the IP. Falls back to the IP so a missing email is still limited.
 */
const byEmailAndIp: KeyOf = (req) => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  const clean = typeof email === 'string' ? email.slice(0, MAX_EMAIL_LENGTH).trim().toLowerCase() : '';
  return clean ? `${clean}|${byIp(req)}` : byIp(req);
};

/** The signed-in user. A request with no session (it will get 401) is counted by its IP instead. */
const byUser: KeyOf = (req) => req.auth?.user.id ?? byIp(req);

// Each call makes a limiter with its own counter. everythingElseByUser is made once, in createApp, so it is one counter
// shared by every route behind the session.
export const limiters = {
  signInFloodByIp: () => limit(RULES.signInFloodByIp, byIp),
  authByIp: () => limit(RULES.authByIp, byIp, { countOnlyFailures: true }),
  signUpByIp: () => limit(RULES.signUpByIp, byIp),
  signInByEmailAndIp: () => limit(RULES.signInByEmailAndIp, byEmailAndIp, { countOnlyFailures: true }),
  classCreateByUser: () => limit(RULES.classCreateByUser, byUser),
  everythingElseByUser: () => limit(RULES.everythingElseByUser, byUser),
};
