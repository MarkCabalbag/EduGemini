import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptKey, encryptKey, lastFour, type EncryptedKey } from './key-crypto';

const API_KEY = 'AIzaSyD-example-key-0123456789abcdef';
const secret = randomBytes(32);

/** A copy of the stored parts with one byte flipped in the chosen part. */
function flipByte(stored: EncryptedKey, part: keyof EncryptedKey): EncryptedKey {
  const changed = Buffer.from(stored[part]);
  changed[0] = (changed[0] ?? 0) ^ 0xff;
  return { ...stored, [part]: changed };
}

/** Every way a stored key can be wrong: each must fail. */
const BROKEN: [string, (stored: EncryptedKey) => EncryptedKey][] = [
  ['a changed ciphertext', (s) => flipByte(s, 'ciphertext')],
  ['a changed tag', (s) => flipByte(s, 'authTag')],
  ['a shortened tag', (s) => ({ ...s, authTag: s.authTag.slice(0, 8) })],
  ['a changed IV', (s) => flipByte(s, 'iv')],
  ['a shortened IV', (s) => ({ ...s, iv: s.iv.slice(0, 11) })],
  ['a truncated ciphertext', (s) => ({ ...s, ciphertext: s.ciphertext.slice(0, -1) })],
];

describe('key encryption (Backend Schema §12.5)', () => {
  it('decrypts to the original key', () => {
    expect(decryptKey(encryptKey(API_KEY, secret), secret)).toBe(API_KEY);
  });

  it('uses a 12-byte IV and a 16-byte tag, and the ciphertext is not the key', () => {
    const stored = encryptKey(API_KEY, secret);
    expect(stored.iv).toHaveLength(12);
    expect(stored.authTag).toHaveLength(16);
    expect(Buffer.from(stored.ciphertext).toString('utf8')).not.toContain(API_KEY.slice(0, 8));
  });

  it('uses a different IV and ciphertext every time, even for the same key', () => {
    const all = Array.from({ length: 200 }, () => encryptKey(API_KEY, secret));
    expect(new Set(all.map((s) => Buffer.from(s.iv).toString('hex'))).size).toBe(200);
    expect(new Set(all.map((s) => Buffer.from(s.ciphertext).toString('hex'))).size).toBe(200);
  });

  it.each(BROKEN)('fails on %s', (_name, change) => {
    expect(() => decryptKey(change(encryptKey(API_KEY, secret)), secret)).toThrowError();
  });

  it('fails with a different secret', () => {
    expect(() => decryptKey(encryptKey(API_KEY, secret), randomBytes(32))).toThrowError();
  });

  it('refuses a secret that is not 32 bytes', () => {
    expect(() => encryptKey(API_KEY, randomBytes(16))).toThrowError();
  });

  it('puts no key text in any error message', () => {
    const stored = encryptKey(API_KEY, secret);
    const wrongSize = randomBytes(16);
    const failures = [
      ...BROKEN.map(
        ([, change]) =>
          () =>
            decryptKey(change(stored), secret),
      ),
      () => decryptKey(stored, randomBytes(32)),
      () => decryptKey(stored, wrongSize),
      () => encryptKey(API_KEY, wrongSize),
    ];
    const leaks = [
      API_KEY,
      ...[secret, wrongSize, stored.ciphertext, stored.iv, stored.authTag].flatMap((b) => [
        Buffer.from(b).toString('hex'),
        Buffer.from(b).toString('base64'),
      ]),
    ];
    for (const run of failures) {
      let error: unknown;
      try {
        run();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      const text = `${(error as Error).message}${(error as Error).stack}${JSON.stringify((error as Error).cause ?? '')}`;
      for (const leak of leaks) expect(text).not.toContain(leak);
    }
  });
});

describe('lastFour', () => {
  it('is the last four characters of the key', () => {
    expect(lastFour(API_KEY)).toBe('cdef');
    expect(lastFour('abcd')).toBe('abcd');
  });
});
