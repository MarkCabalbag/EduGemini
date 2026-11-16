import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { warmUpPasswordHashing } from './auth/password';
import { createStorage } from './lib/create-storage';
import { getEnv } from './lib/env';
import { startJobs } from './jobs';
import { createLogger } from './lib/logger';
import { devFilesRouter } from './routes/dev-files';
import { uploadsRouter } from './routes/uploads';

const env = getEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV);
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const storage = createStorage(env);

const app = createApp({
  env,
  logger,
  db: prisma,
  // A trivial real query, so /healthz also keeps the Supabase project active (TRD §4.2).
  checkDb: async () => {
    await prisma.user.findFirst({ select: { id: true } });
  },
  routers: [
    uploadsRouter({ db: prisma, storage, bucket: env.STORAGE_BUCKET }),
    // Opens the links the local storage signs. Not registered with Supabase storage (env.ts refuses local in production).
    ...(env.STORAGE_DRIVER === 'local' ? [devFilesRouter({ dir: env.STORAGE_LOCAL_DIR, secret: env.SESSION_SECRET })] : []),
  ],
});

warmUpPasswordHashing().catch((error: unknown) => logger.error({ event: 'password.warmup_failed', err: error }));

const server = app.listen(env.PORT, () => logger.info({ event: 'server.listening', port: env.PORT }));

// The worker runs in this process, after the HTTP server starts (TRD §3). Without the pg-boss schema (`pnpm db:boss:init`)
// it fails to start, and so does the API: a missing worker should not go unnoticed.
const boss = await startJobs(env.PGBOSS_URL, { db: prisma, storage, bucket: env.STORAGE_BUCKET, logger }).catch((error: unknown) => {
  logger.error({ event: 'jobs.start_failed', err: error });
  process.exit(1);
});

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
