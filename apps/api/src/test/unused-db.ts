import { PrismaClient } from '@prisma/client';

/** For tests that never reach the database (no session cookie is sent). Prisma connects lazily, so this never connects. */
export const unusedDb = new PrismaClient({ datasourceUrl: 'postgresql://unused:unused@localhost:1/unused' });
