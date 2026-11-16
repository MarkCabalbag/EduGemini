import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TERMS_VERSION, type Role } from '@edugemini/shared';
import { lockInstructorKey } from '../lib/lock';
import type { Actor } from '../policy/policy';
import { createTestDb } from '../test/test-db';
import { deleteKey, getKeyInfo, loadApiKey, saveKey } from './key-service';

// Runs against the test database. The encryption secret is made here, so the tests never touch the real one. Every email
// carries this run's ID, so tests never collide and cleanup is exact (the key rows go with their user).
const RUN = randomUUID().slice(0, 8);
const EMAIL_END = `-${RUN}@example.test`;
const ENV = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENCRYPTION_KEY_VERSION: 1 };

const db = createTestDb();
const makeUser = async (name: string, role: Role = 'INSTRUCTOR'): Promise<Actor> => {
  const user = await db.user.create({
    data: { email: `${name}${EMAIL_END}`, firstName: 'Ada', lastName: 'Lovelace', role, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
  });
  return { id: user.id, role };
};
const rowsOf = (actor: Actor) => db.instructorKey.findMany({ where: { instructorId: actor.id } });
const newApiKey = () => `AIza${randomBytes(18).toString('hex')}`;
const ACK = new Date('2026-11-01T10:00:00Z');

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
});

describe('saving a key (EG-KEY-01)', () => {
  it('stores it encrypted, with only the last four characters in the clear', async () => {
    const actor = await makeUser('encrypted');
    const apiKey = newApiKey();

    await saveKey(db, ENV, actor, apiKey, ACK);

    const [row] = await rowsOf(actor);
    expect(row?.last4).toBe(apiKey.slice(-4));
    expect(row?.keyVersion).toBe(1);
    expect(row?.iv).toHaveLength(12);
    expect(row?.authTag).toHaveLength(16);
    for (const value of Object.values(row ?? {})) {
      const text = value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : String(value);
      expect(text).not.toContain(apiKey); // no column holds the key as it was typed
    }
  });

  it('gives back the last four characters and the non-secret facts, nothing else', async () => {
    const actor = await makeUser('info');
    const apiKey = newApiKey();

    const saved = await saveKey(db, ENV, actor, apiKey, ACK);
    const read = await getKeyInfo(db, actor);

    for (const info of [saved, read]) {
      expect(info).toEqual({ last4: apiKey.slice(-4), lastSuccessAt: null, disclosureAckAt: ACK.toISOString() });
      expect(JSON.stringify(info)).not.toContain(apiKey);
    }
  });

  it('decrypts to the original key', async () => {
    const actor = await makeUser('decrypt');
    const apiKey = newApiKey();
    await saveKey(db, ENV, actor, apiKey, ACK);

    expect(await loadApiKey(db, ENV, actor.id)).toBe(apiKey);
  });

  it('replaces the earlier key: one row, a new IV, the new version, and the first acknowledgement time', async () => {
    const actor = await makeUser('replace');
    const first = newApiKey();
    const second = newApiKey();
    await saveKey(db, ENV, actor, first, ACK);
    const [before] = await rowsOf(actor);

    const info = await saveKey(db, { ...ENV, ENCRYPTION_KEY_VERSION: 2 }, actor, second, new Date('2026-12-01T10:00:00Z'));

    const rows = await rowsOf(actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]?.keyVersion).toBe(2);
    expect(Buffer.from(rows[0]?.iv ?? []).equals(Buffer.from(before?.iv ?? []))).toBe(false);
    expect(info).toMatchObject({ last4: second.slice(-4), disclosureAckAt: ACK.toISOString() });
    expect(await loadApiKey(db, ENV, actor.id)).toBe(second);
  });

  it('waits while another transaction holds the key row', async () => {
    const actor = await makeUser('locked');
    await saveKey(db, ENV, actor, newApiKey(), ACK);
    const second = newApiKey();
    let saved: Promise<unknown> = Promise.resolve();
    let done = false;

    await db.$transaction(async (tx) => {
      await lockInstructorKey(tx, actor.id);
      saved = saveKey(db, ENV, actor, second, ACK).then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(done).toBe(false);
    });
    await saved;

    expect(done).toBe(true);
    expect(await loadApiKey(db, ENV, actor.id)).toBe(second);
  });

  it('keeps one row when two saves arrive together', async () => {
    const actor = await makeUser('together');
    const keys = [newApiKey(), newApiKey()];

    await Promise.all(keys.map((apiKey) => saveKey(db, ENV, actor, apiKey, ACK)));

    expect(await rowsOf(actor)).toHaveLength(1);
    expect(keys).toContain(await loadApiKey(db, ENV, actor.id));
  });
});

describe('reading and removing a key', () => {
  it('has nothing to show before a key is saved', async () => {
    const actor = await makeUser('empty');

    expect(await getKeyInfo(db, actor)).toBeNull();
    expect(await loadApiKey(db, ENV, actor.id)).toBeNull();
  });

  it('removes the row, and removing again does nothing', async () => {
    const actor = await makeUser('remove');
    await saveKey(db, ENV, actor, newApiKey(), ACK);

    await deleteKey(db, actor);
    await deleteKey(db, actor);

    expect(await rowsOf(actor)).toHaveLength(0);
    expect(await getKeyInfo(db, actor)).toBeNull();
    expect(await loadApiKey(db, ENV, actor.id)).toBeNull();
  });

  it("never shows one instructor another's key", async () => {
    const owner = await makeUser('owner');
    const other = await makeUser('other');
    const apiKey = newApiKey();
    await saveKey(db, ENV, owner, apiKey, ACK);

    expect(await getKeyInfo(db, other)).toBeNull();
    await deleteKey(db, other);
    expect(await loadApiKey(db, ENV, owner.id)).toBe(apiKey);
  });

  it('is not available to a student or the Super Admin', async () => {
    for (const role of ['STUDENT', 'SUPER_ADMIN'] as const) {
      const actor = await makeUser(`not-${role.toLowerCase()}`, role);
      await expect(saveKey(db, ENV, actor, newApiKey(), ACK)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(getKeyInfo(db, actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(deleteKey(db, actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await rowsOf(actor)).toHaveLength(0);
    }
  });

  it('fails without the key text when the secret is wrong', async () => {
    const actor = await makeUser('wrong-secret');
    const apiKey = newApiKey();
    await saveKey(db, ENV, actor, apiKey, ACK);
    const wrong = { ...ENV, ENCRYPTION_KEY: randomBytes(32).toString('base64') };

    const error = await loadApiKey(db, wrong, actor.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(apiKey);
    expect((error as Error).message).not.toContain(ENV.ENCRYPTION_KEY);
    expect((error as Error).message).not.toContain(wrong.ENCRYPTION_KEY);
  });
});
