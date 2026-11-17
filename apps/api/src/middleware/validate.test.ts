import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app';
import { createLogger } from '../lib/logger';
import { unusedDb } from '../test/unused-db';
import { validate, validated } from './validate';

const APP_URL = 'http://localhost:5173';

function appWith(router: Router) {
  return createApp({ env: { APP_URL, STORAGE_BUCKET: 'test-bucket' }, logger: createLogger('silent', 'test'), db: unusedDb, checkDb: async () => {}, routers: [router] });
}

describe('validate: query parameters (API Spec A2)', () => {
  const withQuery = { query: z.object({ page: z.string().optional() }) };
  const noQuery = { body: z.object({ name: z.string() }) };

  const router = Router();
  router.get('/with-query', validate(withQuery), (_req, res) => void res.json(validated(res, withQuery)));
  router.post('/no-query', validate(noQuery), (_req, res) => void res.json(validated(res, noQuery)));
  const app = appWith(router);

  it('refuses a parameter a route does not declare, also on a route that declares no query at all', async () => {
    const stray = await request(app).post('/api/no-query?next=/classes').set('Origin', APP_URL).send({ name: 'x' });
    expect(stray.status).toBe(400);
    expect(stray.body.error.code).toBe('VALIDATION');

    const unknown = await request(app).get('/api/with-query?other=1');
    expect(unknown.status).toBe(400);
  });

  it('accepts the declared parameters, and a route with no query still works without any', async () => {
    expect((await request(app).get('/api/with-query?page=2')).body).toEqual({ query: { page: '2' } });
    expect((await request(app).post('/api/no-query').set('Origin', APP_URL).send({ name: 'x' })).body).toEqual({ body: { name: 'x' } });
  });
});
