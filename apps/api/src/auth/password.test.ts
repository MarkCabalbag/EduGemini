import { describe, expect, it } from 'vitest';
import { isCommonPassword } from './common-passwords';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses argon2id, salts every hash, and verifies only the right password', async () => {
    const [a, b] = await Promise.all([hashPassword('correct horse battery'), hashPassword('correct horse battery')]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(a, 'wrong horse battery')).toBe(false);
  });

  it('always fails against the dummy hash', async () => {
    expect(await verifyAgainstDummy('anything at all')).toBe(false);
  });
});

describe('common passwords', () => {
  it('blocks obvious ones in any letter case, and allows others', () => {
    expect(isCommonPassword('Password123')).toBe(true);
    expect(isCommonPassword('QWERTYUIOP')).toBe(true);
    expect(isCommonPassword('plum-violin-stapler-47')).toBe(false);
  });
});
