import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../lib/logger';
import { deleteStagedUploads } from '../services/submission-service';

/** Uploads left open for 24 hours are deleted, with their files (TRD §12). */
export const STAGED_CLEANUP = 'staged.cleanup';

export async function runStagedCleanup({ db, bucket, logger }: { db: PrismaClient; bucket: string; logger: Logger }): Promise<void> {
  const deleted = await deleteStagedUploads(db, bucket);
  logger.info({ event: 'staged.cleanup', deleted });
}
