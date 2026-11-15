import { hash, verify } from '@node-rs/argon2';
import type { Logger } from 'pino';

// argon2id with the OWASP minimum: 19 MiB memory, 2 passes, 1 lane (TRD §6.1). The algorithm defaults to argon2id.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * An unreadable stored hash counts as a wrong password, so sign-in answers the same way as for any other failure. It is
 * logged, so damaged data does not hide behind "wrong password", and it takes as long as a real check (TRD §14).
 * Any other failure (such as running out of memory) is rethrown, so it shows up as a server error.
 */
export async function verifyPassword(passwordHash: string, password: string, log: Logger): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch (error) {
    if ((error as { code?: string }).code !== 'InvalidArg') throw error;
    log.error({ event: 'password.unreadable_hash' });
    return verifyAgainstDummy(password);
  }
}

let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password').catch((error: unknown) => {
    dummyHash = undefined; // try again next time instead of caching the failure
    throw error;
  });
  return dummyHash;
}

/** Call once at startup so the first unknown-email sign-in is not slower than the rest. */
export async function warmUpPasswordHashing(): Promise<void> {
  await getDummyHash();
}

/**
 * Verifies against a throwaway hash. Sign-in calls this when the email is unknown, so a wrong email
 * takes as long as a wrong password and the response time does not reveal which accounts exist (TRD §14).
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  await verify(await getDummyHash(), password);
  return false;
}
