import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app';
import { AppError } from './lib/app-error';
import { createLogger } from './lib/logger';
import { validate, validated } from './middleware/validate';

const APP_URL = 'http://localhost:5173';
const silent = createLogger('silent', 'test');

const testRouter = Router();
testRouter.post(
  '/echo',
  validate({ body: z.object({ title: z.string().min(1), score: z.number() }) }),
  (_req, res) => {
    res.json({ ok: true, input: validated(res) });
  },
);
testRouter.get('/items', validate({ query: z.object({ limit: z.coerce.number().default(25) }) }), (_req, res) => {
  res.json({ items: [], nextCursor: null });
});
testRouter.get('/conflict', () => {
  throw new AppError('ATTEMPTS_EXHAUSTED', { details: { remaining: 0 } });
});
testRouter.get('/limited', () => {
  throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': '60' } });
});
testRouter.get('/boom', () => {
  throw new Error('SELECT * FROM users WHERE password = hunter2');
});

function build(checkDb: () => Promise<void> = async () => {}) {
  return createApp({ env: { APP_URL }, logger: silent, checkDb, routers: [testRouter] });
}

describe('GET /healthz', () => {
  it('returns ok with only status and time', async () => {
    const res = await request(build()).get('/healthz');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['status', 'time']);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 degraded when the database check fails, without internals', async () => {
    const res = await request(build(() => Promise.reject(new Error('connection refused to db.internal')))).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(JSON.stringify(res.body)).not.toContain('internal');
  });
});

describe('origin check', () => {
  const body = { title: 't', score: 1 };

  it('rejects a mutation with no Origin before the body is read', async () => {
    const res = await request(build()).post('/api/echo').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('rejects a foreign Origin', async () => {
    const res = await request(build()).post('/api/echo').set('Origin', 'https://evil.example').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('accepts the app Origin, and never checks GET', async () => {
    const app = build();
    expect((await request(app).post('/api/echo').set('Origin', APP_URL).send(body)).status).toBe(200);
    expect((await request(app).get('/api/items')).status).toBe(200);
  });
});

describe('request parsing', () => {
  it('rejects a body that is not JSON with 415', async () => {
    const res = await request(build()).post('/api/echo').set('Origin', APP_URL).set('Content-Type', 'text/plain').send('hello');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a JSON body over 100 KB with 413', async () => {
    const res = await request(build()).post('/api/echo').set('Origin', APP_URL).send({ title: 'x'.repeat(150_000), score: 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON as VALIDATION', async () => {
    const res = await request(build())
      .post('/api/echo')
      .set('Origin', APP_URL)
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('validate middleware', () => {
  it('reports field errors keyed by JSON path', async () => {
    const res = await request(build()).post('/api/echo').set('Origin', APP_URL).send({ title: '', score: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['score', 'title']);
  });

  it('rejects unknown query parameters', async () => {
    const res = await request(build()).get('/api/items?limit=5&sneaky=1');
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('query');
  });

  it('applies defaults from the schema', async () => {
    const res = await request(build()).get('/api/items?limit=5');
    expect(res.status).toBe(200);
  });
});

describe('error envelope', () => {
  it('maps AppError to its status with details and the request ID', async () => {
    const res = await request(build()).get('/api/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ATTEMPTS_EXHAUSTED', details: { remaining: 0 } });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('forwards headers such as Retry-After', async () => {
    const res = await request(build()).get('/api/limited');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  it('hides the cause of an unexpected error', async () => {
    const res = await request(build()).get('/api/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|hunter2|stack|at /);
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await request(build()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('headers', () => {
  it('sends no-store on API responses and hides the framework', async () => {
    const res = await request(build()).get('/api/items');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
