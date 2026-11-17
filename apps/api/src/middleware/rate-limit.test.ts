import { Router } from 'express';
import { MAX_EMAIL_LENGTH } from '@edugemini/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createLogger } from '../lib/logger';
import { unusedDb } from '../test/unused-db';
import { limit, limiters, RULES } from './rate-limit';

const APP_URL = 'http://localhost:5173';

function appWith(...routers: Router[]) {
  return createApp({ env: { APP_URL, STORAGE_BUCKET: 'test-bucket' }, logger: createLogger('silent', 'test'), db: unusedDb, checkDb: async () => {}, routers });
}

const post = (app: ReturnType<typeof appWith>, path: string, body: object = {}) =>
  request(app).post(path).set('Origin', APP_URL).send(body);

describe('rate limits (API Spec A12)', () => {
  it('follows the documented numbers', () => {
    expect(RULES.signInFloodByIp).toEqual({ windowMs: 15 * 60_000, limit: 300 });
    expect(RULES.authByIp).toEqual({ windowMs: 15 * 60_000, limit: 20 });
    expect(RULES.signUpByIp).toEqual({ windowMs: 60 * 60_000, limit: 60 });
    expect(RULES.signInByEmailAndIp).toEqual({ windowMs: 15 * 60_000, limit: 5 });
    expect(RULES.classCreateByUser).toEqual({ windowMs: 60 * 60_000, limit: 20 });
    expect(RULES.joinByUser).toEqual({ windowMs: 60 * 60_000, limit: 10 });
    expect(RULES.joinPreviewByIp).toEqual({ windowMs: 60 * 60_000, limit: 30 });
    expect(RULES.notificationsByUser).toEqual({ windowMs: 60_000, limit: 300 });
    expect(RULES.everythingElseByUser).toEqual({ windowMs: 60_000, limit: 120 });
  });

  it('answers 429 RATE_LIMITED with Retry-After and RateLimit headers once the limit is passed', async () => {
    const router = Router();
    router.post('/ping', limit({ windowMs: 60_000, limit: 2 }, () => 'k'), (_req, res) => void res.json({ ok: true }));
    const app = appWith(router);

    expect((await post(app, '/api/ping')).status).toBe(200);
    expect((await post(app, '/api/ping')).status).toBe(200);
    const res = await post(app, '/api/ping');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['ratelimit-limit']).toBe('2');
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });

  it('counts failed sign-ins per email, ignoring case, and keeps other emails independent', async () => {
    const router = Router();
    router.post('/signin', limiters.signInByEmailAndIp(), (_req, res) => void res.status(401).json({}));
    const app = appWith(router);

    for (let i = 0; i < RULES.signInByEmailAndIp.limit; i++) {
      const email = i % 2 ? 'Ada@Example.com' : 'ada@example.com';
      expect((await post(app, '/api/signin', { email })).status).toBe(401);
    }
    expect((await post(app, '/api/signin', { email: 'ADA@example.com' })).status).toBe(429);
    expect((await post(app, '/api/signin', { email: 'grace@example.com' })).status).toBe(401);
  });

  it('does not let a stranger lock the real owner out: another IP is counted separately', async () => {
    const router = Router();
    router.post('/signin', limiters.signInByEmailAndIp(), (_req, res) => void res.status(401).json({}));
    const app = appWith(router);
    const from = (ip: string) => request(app).post('/api/signin').set('Origin', APP_URL).set('X-Forwarded-For', ip).send({ email: 'ada@example.com' });

    for (let i = 0; i < RULES.signInByEmailAndIp.limit; i++) await from('203.0.113.5');
    expect((await from('203.0.113.5')).status).toBe(429); // the attacker's network is blocked
    expect((await from('198.51.100.7')).status).toBe(401); // the owner's network is not
  });

  it('cuts an oversized email to the longest valid length, so it cannot be used to fill memory', async () => {
    const router = Router();
    router.post('/signin', limiters.signInByEmailAndIp(), (_req, res) => void res.status(401).json({}));
    const app = appWith(router);
    const longEmail = (ending: string) => 'a'.repeat(MAX_EMAIL_LENGTH) + ending;

    for (let i = 0; i < RULES.signInByEmailAndIp.limit; i++) await post(app, '/api/signin', { email: longEmail(`${i}`) });
    expect((await post(app, '/api/signin', { email: longEmail('different') })).status).toBe(429);
  });

  it('does not count successful sign-ins against the email', async () => {
    const router = Router();
    router.post('/signin', limiters.signInByEmailAndIp(), (_req, res) => void res.json({ ok: true }));
    const app = appWith(router);

    for (let i = 0; i < RULES.signInByEmailAndIp.limit * 2; i++) {
      expect((await post(app, '/api/signin', { email: 'ada@example.com' })).status).toBe(200);
    }
  });

  it('gives the notification routes 300 a minute of their own, not the general 120 (counted by IP when there is no session)', async () => {
    const app = appWith();
    const polls = Array.from({ length: RULES.notificationsByUser.limit + 1 }, () => request(app).get('/api/notifications/unread-count'));

    const statuses = (await Promise.all(polls)).map((res) => res.status);

    expect(statuses.filter((status) => status === 401)).toHaveLength(RULES.notificationsByUser.limit); // answered, not limited
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
  });

  // The per-user limits are tested on the real routes with real sessions: see services/class.int.test.ts.
  it('covers routes added through `routers` too, counting a caller with no session by IP', async () => {
    const router = Router();
    router.get('/added-later', (_req, res) => void res.json({ ok: true }));
    const app = appWith(router);
    const get = () => request(app).get('/api/added-later');

    for (let i = 0; i < RULES.everythingElseByUser.limit; i++) expect((await get()).status).toBe(200);
    const res = await get();

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
