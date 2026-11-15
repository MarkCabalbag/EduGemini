import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger';
import { isCommonPassword } from './common-passwords';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';

const log = createLogger('silent', 'test');

describe('password hashing', () => {
  it('uses argon2id, salts every hash, and verifies only the right password', async () => {
    const [a, b] = await Promise.all([hashPassword('correct horse battery'), hashPassword('correct horse battery')]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse battery', log)).toBe(true);
    expect(await verifyPassword(a, 'wrong horse battery', log)).toBe(false);
  });

  it('treats a stored hash it cannot read as a wrong password, and logs it', async () => {
    const error = vi.fn();
    expect(await verifyPassword('not-a-real-hash', 'anything', { error } as unknown as Logger)).toBe(false);
    expect(error).toHaveBeenCalledWith({ event: 'password.unreadable_hash' });
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
