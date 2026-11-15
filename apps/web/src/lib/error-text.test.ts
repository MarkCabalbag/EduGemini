import type { ErrorCode } from '@edugemini/shared';
import { describe, expect, it } from 'vitest';
import { errorText } from './error-text';

describe('errorText', () => {
  it('uses the canonical strings, and a generic one for codes it does not know', () => {
    expect(errorText('INVALID_CREDENTIALS')).toBe('Email or password is incorrect.');
    expect(errorText('NOT_A_CODE' as ErrorCode)).toBe('Something went wrong.');
  });
});
