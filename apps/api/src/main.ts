import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { warmUpPasswordHashing } from './auth/password';
import { getEnv } from './lib/env';
import { createLogger } from './lib/logger';
import { devFilesRouter } from './routes/dev-files';

const env = getEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV);
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

const app = createApp({
  env,
  logger,
  db: prisma,
  // A trivial real query, so /healthz also keeps the Supabase project active (TRD §4.2).
  checkDb: async () => {
    await prisma.user.findFirst({ select: { id: true } });
  },
  // Opens the links the local storage signs. Not registered with Supabase storage (env.ts refuses local in production).
  routers: env.STORAGE_DRIVER === 'local' ? [devFilesRouter({ dir: env.STORAGE_LOCAL_DIR, secret: env.SESSION_SECRET })] : [],
});

warmUpPasswordHashing().catch((error: unknown) => logger.error({ event: 'password.warmup_failed', err: error }));

const server = app.listen(env.PORT, () => logger.info({ event: 'server.listening', port: env.PORT }));

function shutdown(signal: string) {
  logger.info({ event: 'server.shutdown', signal });
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
