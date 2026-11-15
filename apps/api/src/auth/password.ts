import { hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP minimum: 19 MiB memory, 2 passes, 1 lane (TRD §6.1). The algorithm defaults to argon2id.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
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
  await verifyPassword(await getDummyHash(), password);
  return false;
}
