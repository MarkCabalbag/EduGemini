import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../lib/logger';
import type { StorageAdapter } from '../lib/storage';

/** Deletes the objects listed in the storage outbox (Backend Schema §10.1, TRD §12). */
export const STORAGE_CLEANUP = 'storage.cleanup';

// One run takes this many rows at most, so a long list is finished over a few runs.
const BATCH_SIZE = 500;

/**
 * Delete the objects of the pending `storage_deletions` rows and mark each row complete once its object is gone (a missing
 * object counts as gone). A failure is written on its row and the others go on. A row that failed stays pending and is tried
 * again on the next run, after the rows that have failed less often, so one bad row cannot hold up the rest.
 */
export async function runStorageCleanup({ db, storage, logger }: { db: PrismaClient; storage: StorageAdapter; logger: Logger }): Promise<void> {
  const pending = await db.storageDeletion.findMany({
    where: { completedAt: null },
    orderBy: [{ attempts: 'asc' }, { requestedAt: 'asc' }],
    take: BATCH_SIZE,
  });

  let deleted = 0;
  for (const row of pending) {
    try {
      await storage.remove(row.bucket, [row.objectPath]);
      if (await storage.exists(row.bucket, row.objectPath)) throw new Error('The object is still there after it was removed.');
      await db.storageDeletion.update({ where: { id: row.id }, data: { completedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      deleted++;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      await db.storageDeletion.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError } });
    }
  }
  logger.info({ event: 'storage.cleanup', deleted, failed: pending.length - deleted });
}
