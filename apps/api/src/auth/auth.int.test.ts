import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeSchema, TERMS_VERSION } from '@edugemini/shared';
import { createApp } from '../app';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { hashPassword } from './password';
import { SESSION_COOKIE } from './session';

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const PASSWORD = 'plum-violin-stapler-47';

const db = createTestDb();
const email = (name: string) => `${name}-${RUN}@example.test`;

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({ env: { APP_URL, STORAGE_BUCKET: 'test-bucket' }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });

const signUpBody = (name: string, overrides: object = {}) => ({
  email: email(name),
  password: PASSWORD,
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'STUDENT',
  acceptTerms: true,
  termsVersion: TERMS_VERSION,
  ...overrides,
});

const post = (app: ReturnType<typeof build>, path: string, body?: object) =>
  request(app).post(path).set('Origin', APP_URL).send(body);

/** The session token from a Set-Cookie header. */
function tokenFrom(res: request.Response): string {
  const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('No session cookie was set');
  return cookie.split(';')[0]!.slice(SESSION_COOKIE.length + 1);
}

const withSession = (app: ReturnType<typeof build>, token: string) =>
  request(app).get('/api/me').set('Cookie', `${SESSION_COOKIE}=${token}`);

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.test` } } }); // sessions cascade
  await db.$disconnect();
});

describe('sign up', () => {
  it('creates the account, signs the user in, and stores only hashes', async () => {
    const app = build();
    const res = await post(app, '/api/auth/signup', signUpBody('new'));

    expect(res.status).toBe(201);
    expect(MeSchema.parse(res.body)).toMatchObject({ email: email('new'), role: 'STUDENT', emailVerified: false });
    expect(res.body).not.toHaveProperty('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    const user = await db.user.findUniqueOrThrow({ where: { email: email('new') } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.termsAcceptedAt).not.toBeNull();
    expect(user.termsVersion).toBe(TERMS_VERSION);

    const token = tokenFrom(res);
    const stored = await db.session.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(token); // the database never holds the cookie value
  });

  it('refuses a second account with the same email, in any letter case', async () => {
    const app = build();
    await post(app, '/api/auth/signup', signUpBody('dup'));
    const res = await post(app, '/api/auth/signup', signUpBody('dup', { email: email('dup').toUpperCase() }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('lets only one of two simultaneous sign-ups win', async () => {
    const app = build();
    const results = await Promise.all([
      post(app, '/api/auth/signup', signUpBody('race')),
      post(app, '/api/auth/signup', signUpBody('race')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { email: email('race') } })).toBe(1);
  });

  it.each([
    ['a short password', { password: 'short' }, 'password'],
    ['a common password', { password: 'Password123' }, 'password'],
    ['the Super Admin role', { role: 'SUPER_ADMIN' }, 'role'],
    ['unaccepted terms', { acceptTerms: false }, 'acceptTerms'],
    ['a malformed email', { email: 'nope' }, 'email'],
  ])('rejects %s', async (_label, overrides, field) => {
    const res = await post(build(), '/api/auth/signup', signUpBody('invalid', overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fields).toHaveProperty(field);
  });

  it('lets a class sign up from one network, and limits abuse at 60 per hour per IP', async () => {
    const app = build();
    // 12 quick sign-ups cost little; the 60-per-hour number itself is checked in rate-limit.test.ts.
    for (let i = 0; i < 12; i++) {
      expect((await post(app, '/api/auth/signup', signUpBody(`class${i}`))).status).toBe(201);
    }
  });
});

describe('sign in', () => {
  const name = 'signin';
  beforeAll(async () => {
    await post(build(), '/api/auth/signup', signUpBody(name));
  });

  it('signs in with the right password, whatever the email case', async () => {
    const res = await post(build(), '/api/auth/signin', { email: email(name).toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(MeSchema.parse(res.body).email).toBe(email(name));
    expect(tokenFrom(res)).toBeTruthy();
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await post(build(), '/api/auth/signin', { email: email(name), password: 'not-the-password' });
    const unknownEmail = await post(build(), '/api/auth/signin', { email: email('nobody'), password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect({ ...unknownEmail.body.error, requestId: '' }).toEqual({ ...wrongPassword.body.error, requestId: '' });
    expect(unknownEmail.headers['set-cookie']).toBeUndefined();
  });

  it('treats an account with no password as invalid credentials', async () => {
    await db.user.create({
      data: { email: email('no-password'), firstName: 'G', lastName: 'O', role: 'STUDENT', termsAcceptedAt: new Date() },
    });
    const res = await post(build(), '/api/auth/signin', { email: email('no-password'), password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('is limited to 5 failed attempts per email and IP in 15 minutes', async () => {
    const app = build();
    for (let i = 0; i < 5; i++) await post(app, '/api/auth/signin', { email: email('locked'), password: 'x' });
    const res = await post(app, '/api/auth/signin', { email: email('locked'), password: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('reports a suspended account only after the right password', async () => {
    await post(build(), '/api/auth/signup', signUpBody('suspended'));
    await db.user.update({ where: { email: email('suspended') }, data: { suspendedAt: new Date() } });

    const stranger = await post(build(), '/api/auth/signin', { email: email('suspended'), password: 'wrong-password-1' });
    expect(stranger.body.error.code).toBe('INVALID_CREDENTIALS');

    const owner = await post(build(), '/api/auth/signin', { email: email('suspended'), password: PASSWORD });
    expect(owner.status).toBe(403);
    expect(owner.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(owner.headers['set-cookie']).toBeUndefined();
  });
});

describe('the session', () => {
  it('opens /me, and signing out ends it', async () => {
    const app = build();
    const token = tokenFrom(await post(app, '/api/auth/signup', signUpBody('session')));

    expect((await withSession(app, token)).status).toBe(200);
    expect((await request(app).get('/api/me')).status).toBe(401);

    const out = await request(app).post('/api/auth/signout').set('Origin', APP_URL).set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(out.status).toBe(204);
    expect((await withSession(app, token)).status).toBe(401);
  });

  it('ends the session the browser already held when it signs in again', async () => {
    const app = build();
    const first = tokenFrom(await post(app, '/api/auth/signup', signUpBody('replace')));

    const again = await request(app)
      .post('/api/auth/signin')
      .set('Origin', APP_URL)
      .set('Cookie', `${SESSION_COOKIE}=${first}`)
      .send({ email: email('replace'), password: PASSWORD });
    const second = tokenFrom(again);

    expect(second).not.toBe(first);
    expect((await withSession(app, first)).status).toBe(401); // the old token no longer works
    expect((await withSession(app, second)).status).toBe(200);
  });

  it('signs out with 204 even when there is no session', async () => {
    expect((await post(build(), '/api/auth/signout')).status).toBe(204);
  });

  it('rejects a forged token', async () => {
    const res = await withSession(build(), 'not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expires after 30 days, and after 7 days without use', async () => {
    const app = build();
    const user = (name: string) => db.user.findUniqueOrThrow({ where: { email: email(name) } });
    const DAY = 24 * 60 * 60 * 1000;

    const absolute = tokenFrom(await post(app, '/api/auth/signup', signUpBody('expiry-abs')));
    // Back-date the whole session: the database requires expires_at to be after created_at.
    await db.session.updateMany({
      where: { userId: (await user('expiry-abs')).id },
      data: { createdAt: new Date(Date.now() - 31 * DAY), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await withSession(app, absolute)).status).toBe(401);
    expect(await db.session.count({ where: { userId: (await user('expiry-abs')).id } })).toBe(0); // cleaned up

    const idle = tokenFrom(await post(app, '/api/auth/signup', signUpBody('expiry-idle')));
    await db.session.updateMany({ where: { userId: (await user('expiry-idle')).id }, data: { lastSeenAt: new Date(Date.now() - 8 * DAY) } });
    expect((await withSession(app, idle)).status).toBe(401);
  });

  it('blocks a user who is suspended while signed in, on the very next request', async () => {
    const app = build();
    const token = tokenFrom(await post(app, '/api/auth/signup', signUpBody('suspend-live')));
    expect((await withSession(app, token)).status).toBe(200);

    await db.user.update({ where: { email: email('suspend-live') }, data: { suspendedAt: new Date() } });
    const res = await withSession(app, token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('ignores a session whose account became a tombstone', async () => {
    const app = build();
    const token = tokenFrom(await post(app, '/api/auth/signup', signUpBody('tomb')));
    await db.user.update({
      where: { email: email('tomb') },
      data: { tombstone: true, passwordHash: null, email: `deleted-${RUN}-tomb@tombstone.invalid` },
    });
    expect((await withSession(app, token)).status).toBe(401);
    await db.user.deleteMany({ where: { email: `deleted-${RUN}-tomb@tombstone.invalid` } });
  });
});

describe('the password in the database', () => {
  it('matches what sign-in verifies, and is never the plain text', async () => {
    await post(build(), '/api/auth/signup', signUpBody('hash'));
    const user = await db.user.findUniqueOrThrow({ where: { email: email('hash') } });
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await hashPassword(PASSWORD)).not.toBe(user.passwordHash); // salted
  });
});
