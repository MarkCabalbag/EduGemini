import type { PrismaClient } from '@prisma/client';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import type { Env } from './lib/env';
import type { Logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/error-handler';
import { jsonBody } from './middleware/json-body';
import { originCheck } from './middleware/origin-check';
import { limiters } from './middleware/rate-limit';
import { requestContext } from './middleware/request-id';
import { loadSession } from './middleware/session';
import { authRouter } from './routes/auth';
import { classesRouter } from './routes/classes';
import { healthRouter } from './routes/health';
import { joinLinkRouter } from './routes/join-link';
import { meRouter } from './routes/me';
import { peopleRouter } from './routes/people';

export type AppDeps = {
  env: Pick<Env, 'APP_URL'>;
  logger: Logger;
  db: PrismaClient;
  /** A trivial query that proves the database answers. */
  checkDb: () => Promise<void>;
  /** Feature routers, mounted under /api after the shared middleware. */
  routers?: Router[];
};

/** Middleware order: code-standards §5. */
export function createApp({ env, logger, db, checkDb, routers = [] }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render sits behind the Vercel rewrite (TRD §6.5)

  app.use(requestContext(logger));
  app.use(helmet());
  app.use(healthRouter(checkDb));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(originCheck(env.APP_URL));
  api.use(...jsonBody());
  api.use(authRouter({ db, appUrl: env.APP_URL })); // public: no session needed
  api.use(loadSession(db)); // everything below may use req.auth
  api.use(joinLinkRouter({ db })); // public, and with its own limit, so it sits before the general one (API Spec A12)
  api.use(limiters.everythingElseByUser()); // one counter per user (the IP when signed out) for every route below
  api.use(meRouter());
  api.use(classesRouter({ db, appUrl: env.APP_URL }));
  api.use(peopleRouter({ db }));
  for (const router of routers) api.use(router);
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
