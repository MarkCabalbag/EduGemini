import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createLogger } from '../lib/logger';
import { limit, limiters, RULES } from './rate-limit';

const APP_URL = 'http://localhost:5173';

function appWith(...routers: Router[]) {
  return createApp({ env: { APP_URL }, logger: createLogger('silent', 'test'), checkDb: async () => {}, routers });
}

const post = (app: ReturnType<typeof appWith>, path: string, body: object = {}) =>
  request(app).post(path).set('Origin', APP_URL).send(body);

describe('rate limits (TRD §6.7)', () => {
  it('follows the documented numbers', () => {
    expect(RULES.authByIp).toEqual({ windowMs: 15 * 60_000, limit: 20 });
    expect(RULES.signInByEmail).toEqual({ windowMs: 15 * 60_000, limit: 5 });
    expect(RULES.resetByEmail).toEqual({ windowMs: 60 * 60_000, limit: 3 });
    expect(RULES.joinByUser).toEqual({ windowMs: 60 * 60_000, limit: 10 });
    expect(RULES.uploadByUser).toEqual({ windowMs: 60_000, limit: 60 });
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

  it('counts sign-in attempts per email, ignoring case, and keeps other emails independent', async () => {
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

  it('limits per user when signed in', async () => {
    const router = Router();
    const userId = (req: { get: (h: string) => string | undefined }) => req.get('x-test-user');
    router.post('/join', limiters.joinByUser(userId), (_req, res) => void res.json({ ok: true }));
    const app = appWith(router);

    for (let i = 0; i < RULES.joinByUser.limit; i++) {
      expect((await post(app, '/api/join').set('X-Test-User', 'u1')).status).toBe(200);
    }
    expect((await post(app, '/api/join').set('X-Test-User', 'u1')).status).toBe(429);
    expect((await post(app, '/api/join').set('X-Test-User', 'u2')).status).toBe(200);
  });
});
