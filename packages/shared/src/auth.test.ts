import { describe, expect, it } from 'vitest';
import { SignInSchema, SignUpSchema, TERMS_VERSION } from './auth';

const valid = {
  email: '  Ada@Example.COM ',
  password: 'plum-violin-stapler',
  firstName: ' Ada ',
  lastName: 'Lovelace',
  role: 'STUDENT',
  acceptTerms: true,
  termsVersion: TERMS_VERSION,
};

describe('SignUpSchema', () => {
  it('trims and lower-cases the email and trims names', () => {
    const parsed = SignUpSchema.parse(valid);
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.firstName).toBe('Ada');
  });

  it('rejects a short password, a Super Admin role, and missing terms', () => {
    expect(SignUpSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, role: 'SUPER_ADMIN' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, acceptTerms: undefined }).success).toBe(false);
  });

  it('asks for a role in plain words when none is chosen', () => {
    const result = SignUpSchema.safeParse({ ...valid, role: undefined });
    expect(result.success ? '' : result.error.issues[0]?.message).toBe('Choose a role');
  });

  it('rejects a Terms version that is not the current one', () => {
    expect(SignUpSchema.safeParse({ ...valid, termsVersion: 'x' }).success).toBe(false);
  });

  it('rejects a malformed email and blank names', () => {
    expect(SignUpSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false);
  });
});

describe('SignInSchema', () => {
  it('only needs an email and some password', () => {
    expect(SignInSchema.parse({ email: 'A@b.co', password: 'x' })).toEqual({ email: 'a@b.co', password: 'x' });
    expect(SignInSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
