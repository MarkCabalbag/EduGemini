import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for an instructor's Gemini key (Backend Schema §12.5). The caller supplies the 32-byte secret, which comes from
// the env module. Nothing here logs, and no error message holds the key, the ciphertext or the secret.

const IV_BYTES = 12;
const TAG_BYTES = 16;

// The bytes are `Uint8Array<ArrayBuffer>`, the type Prisma uses for a `bytea` column.
type Bytes = Uint8Array<ArrayBuffer>;
export type EncryptedKey = { ciphertext: Bytes; iv: Bytes; authTag: Bytes };

/** Encrypt with a new random IV every time: an IV must never be reused with the same secret. */
export function encryptKey(apiKey: string, secret: Uint8Array): EncryptedKey {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', secret, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/** Decrypt, checking the 16-byte tag. A wrong secret, IV or tag, or a changed ciphertext, throws. */
export function decryptKey({ ciphertext, iv, authTag }: EncryptedKey, secret: Uint8Array): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Fixed text, and no `cause`, so nothing from the failed attempt travels with the error.
    throw new Error('The stored Gemini key could not be decrypted');
  }
}

/** The only part of a key that is ever shown (FR-KEY-03). */
export const lastFour = (apiKey: string): string => apiKey.slice(-4);
