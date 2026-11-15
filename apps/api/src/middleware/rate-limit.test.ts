import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createLogger } from '../lib/logger';
import { unusedDb } from '../test/unused-db';
import { limit, limiters, RULES } from './rate-limit';

const APP_URL = 'http://localhost:5173';

function appWith(...routers: Router[]) {
  return createApp({ env: { APP_URL }, logger: createLogger('silent', 'test'), db: unusedDb, checkDb: async () => {}, routers });
}

const post = (app: ReturnType<typeof appWith>, path: string, body: object = {}) =>
  request(app).post(path).set('Origin', APP_URL).send(body);

describe('rate limits (API Spec A12)', () => {
  it('follows the documented numbers', () => {
    expect(RULES.signInFloodByIp).toEqual({ windowMs: 15 * 60_000, limit: 300 });
    expect(RULES.authByIp).toEqual({ windowMs: 15 * 60_000, limit: 20 });
    expect(RULES.signUpByIp).toEqual({ windowMs: 60 * 60_000, limit: 60 });
    expect(RULES.signInByEmail).toEqual({ windowMs: 15 * 60_000, limit: 5 });
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
    router.post('/signin', limiters.signInByEmail(), (_req, res) => void res.status(401).json({}));
    const app = appWith(router);

    for (let i = 0; i < RULES.signInByEmail.limit; i++) {
      const email = i % 2 ? 'Ada@Example.com' : 'ada@example.com';
      expect((await post(app, '/api/signin', { email })).status).toBe(401);
    }
    expect((await post(app, '/api/signin', { email: 'ADA@example.com' })).status).toBe(429);
    expect((await post(app, '/api/signin', { email: 'grace@example.com' })).status).toBe(401);
  });

  it('does not count successful sign-ins against the email', async () => {
    const router = Router();
    router.post('/signin', limiters.signInByEmail(), (_req, res) => void res.json({ ok: true }));
    const app = appWith(router);

    for (let i = 0; i < RULES.signInByEmail.limit * 2; i++) {
      expect((await post(app, '/api/signin', { email: 'ada@example.com' })).status).toBe(200);
    }
  });
});
