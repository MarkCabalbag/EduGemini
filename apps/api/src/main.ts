import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { warmUpPasswordHashing } from './auth/password';
import { createGemini } from './lib/create-gemini';
import { startKeepAlive } from './lib/keep-alive';
import { getEnv } from './lib/env';
import { createGradingSender } from './jobs/grade-submission.job';
import { startJobs } from './jobs';
import { createLogger } from './lib/logger';
import { createPacer } from './lib/pacing';
import { createSupabaseStorage } from './lib/supabase-storage';
import { keyRouter } from './routes/key';
import { uploadsRouter } from './routes/uploads';

const env = getEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV);
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const storage = createSupabaseStorage({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });

// The worker runs in this process (TRD §3). It starts first, without being awaited, because finalize sends grading jobs through
// it: a finalize that arrives while it is still starting waits for it. Without the pg-boss schema (`pnpm db:boss:init`) it fails
// to start, and so does the API: a missing worker should not go unnoticed.
const bossReady = startJobs(env.PGBOSS_URL, {
  db: prisma,
  storage,
  bucket: env.STORAGE_BUCKET,
  gemini: createGemini(env),
  pacer: createPacer(),
  env,
  logger,
}).catch((error: unknown) => {
  logger.error({ event: 'jobs.start_failed', err: error });
  process.exit(1);
});

const app = createApp({
  env,
  logger,
  db: prisma,
  // A trivial real query, so /healthz also keeps the Supabase project active (TRD §4.2).
  checkDb: async () => {
    await prisma.user.findFirst({ select: { id: true } });
  },
  routers: [
    keyRouter({ db: prisma, env }),
    uploadsRouter({ db: prisma, storage, bucket: env.STORAGE_BUCKET, enqueueGrading: createGradingSender(bossReady, logger) }),
  ],
});

warmUpPasswordHashing().catch((error: unknown) => logger.error({ event: 'password.warmup_failed', err: error }));

const server = app.listen(env.PORT, () => logger.info({ event: 'server.listening', port: env.PORT }));

// On Render the service sleeps after 15 quiet minutes; pinging its own public address keeps it awake.
if (env.RENDER_EXTERNAL_URL) startKeepAlive(env.RENDER_EXTERNAL_URL, logger);

const boss = await bossReady;

function shutdown(signal: string) {
  logger.info({ event: 'server.shutdown', signal });
  server.close(() => {
    // Let a running job finish (up to 8 seconds), then close the database.
    void boss
      .stop({ timeout: 8_000 })
      .catch((error: unknown) => logger.error({ event: 'jobs.stop_failed', err: error }))
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
