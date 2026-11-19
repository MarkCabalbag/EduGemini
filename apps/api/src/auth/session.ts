import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { CookieOptions, Request } from 'express';
import type { Me } from '@edugemini/shared';
import { ME_SELECT, toMe } from './me';

// Database sessions (TRD §6.2). The cookie holds a random token; the database holds only its SHA-256 hash.

export const SESSION_COOKIE = 'eg_session';

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 7 * DAY_MS;
const ABSOLUTE_TIMEOUT_MS = 30 * DAY_MS;
/** last_seen_at is written at most this often, to limit database writes. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthSession = { sessionId: string; user: Me };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function cookieOptions(appUrl: string): CookieOptions {
  return {
    httpOnly: true,
    secure: appUrl.startsWith('https://'), // plain http only for local development
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TIMEOUT_MS,
  };
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return undefined; // a malformed cookie is simply no session
      }
    }
  }
  return undefined;
}

/** A new token for the cookie, and the session data that stores only its hash. */
export function newSession() {
  const token = randomBytes(32).toString('base64url');
  return { token, data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ABSOLUTE_TIMEOUT_MS) } };
}

/** Creates a session for an existing user and returns the token to put in the cookie. */
export async function createSession(db: PrismaClient, userId: string): Promise<string> {
  const { token, data } = newSession();
  await db.session.create({ data: { userId, ...data } });
  return token;
}

export async function deleteSession(db: PrismaClient, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** The session behind a token, or undefined if it is unknown, expired, idle too long, or the account is gone. */
export async function findSession(db: PrismaClient, token: string, now = new Date()): Promise<AuthSession | undefined> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, lastSeenAt: true, expiresAt: true, user: { select: { ...ME_SELECT, tombstone: true } } },
  });
  if (!session) return undefined;

  const expired = session.expiresAt <= now || session.lastSeenAt.getTime() + IDLE_TIMEOUT_MS <= now.getTime();
  if (expired) {
    await db.session.deleteMany({ where: { id: session.id } });
    return undefined;
  }
  if (session.user.tombstone) return undefined;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // updateMany: the session may have been deleted a moment ago (sign-out), which is not an error.
    await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return { sessionId: session.id, user: toMe(session.user) };
}
