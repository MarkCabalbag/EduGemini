import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/app-error';
import type { Env } from '../lib/env';
import { decryptKey, encryptKey, lastFour } from '../lib/key-crypto';
import { lockInstructorKey } from '../lib/lock';
import { authorize, type Actor } from '../policy/policy';

/**
 * Storage for an instructor's Gemini key (EG-KEY-01). It stores the key encrypted, one row per instructor, and gives back
 * only non-secret facts. The plaintext leaves this file in one place: `loadApiKey`, for the grading job. It never logs, and no
 * error here carries the key. It does not check the key with Gemini and does not set or return `status`: a new row gets the
 * column's default (`CONNECTED`), which means nothing until the key is checked (Backend Schema §4.6).
 */

type KeyEnv = Pick<Env, 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_VERSION'>;

/** What may leave the server about a key (FR-KEY-03): never the key and never the ciphertext. */
export type KeyInfo = { last4: string; lastSuccessAt: string | null; disclosureAckAt: string };

const INFO_FIELDS = { last4: true, lastSuccessAt: true, disclosureAckAt: true } as const;

const toKeyInfo = (row: { last4: string; lastSuccessAt: Date | null; disclosureAckAt: Date }): KeyInfo => ({
  last4: row.last4,
  lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
  disclosureAckAt: row.disclosureAckAt.toISOString(),
});

const secretOf = (env: KeyEnv) => Buffer.from(env.ENCRYPTION_KEY, 'base64');

/**
 * Save the instructor's key, replacing any earlier one (API Spec KEY-02, Effects and Concurrency). The first save needs the
 * acknowledgement (`disclosureAckAt`, null when the instructor did not tick it) and records it; a replace keeps the first one.
 * Checking the key with Gemini is EG-KEY-03; until it exists the key is stored unchecked.
 */
export async function saveKey(db: PrismaClient, env: KeyEnv, actor: Actor, apiKey: string, disclosureAckAt: Date | null): Promise<KeyInfo> {
  authorize(actor, 'key.manage');
  const stored = { ...encryptKey(apiKey, secretOf(env)), keyVersion: env.ENCRYPTION_KEY_VERSION, last4: lastFour(apiKey) };
  const row = await db.$transaction(async (tx) => {
    await lockInstructorKey(tx, actor.id);
    const saved = await tx.instructorKey.findUnique({ where: { instructorId: actor.id }, select: { id: true } });
    if (saved) return tx.instructorKey.update({ where: { instructorId: actor.id }, data: stored, select: INFO_FIELDS });
    if (!disclosureAckAt) {
      throw new AppError('VALIDATION', { fields: { disclosureAcknowledged: 'Tick "I understand" to save your key.' } });
    }
    // An upsert, not a create: two first saves at once have no row to lock, and the unique index must leave one row.
    return tx.instructorKey.upsert({
      where: { instructorId: actor.id },
      create: { instructorId: actor.id, ...stored, disclosureAckAt },
      update: stored,
      select: INFO_FIELDS,
    });
  });
  return toKeyInfo(row);
}

/** The instructor's own key facts, or null when no key is saved. */
export async function getKeyInfo(db: PrismaClient, actor: Actor): Promise<KeyInfo | null> {
  authorize(actor, 'key.manage');
  const row = await db.instructorKey.findUnique({ where: { instructorId: actor.id }, select: INFO_FIELDS });
  return row && toKeyInfo(row);
}

/** Remove the instructor's key. Nothing happens when there is none. */
export async function deleteKey(db: PrismaClient, actor: Actor): Promise<void> {
  authorize(actor, 'key.manage');
  await db.instructorKey.deleteMany({ where: { instructorId: actor.id } });
}

/**
 * The plaintext key, for the grading job to call Gemini with (TRD §10.3), or null when the instructor has none. The job acts for
 * the instructor and has no signed-in actor, so there is no check here. Never log or return what this gives back.
 */
export async function loadApiKey(db: PrismaClient, env: KeyEnv, instructorId: string): Promise<string | null> {
  const row = await db.instructorKey.findUnique({
    where: { instructorId },
    select: { ciphertext: true, iv: true, authTag: true },
  });
  return row && decryptKey(row, secretOf(env));
}
