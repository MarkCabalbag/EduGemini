import type { ErrorCode } from '@edugemini/shared';
import { describe, expect, it } from 'vitest';
import { errorText } from './error-text';

describe('errorText', () => {
  it('uses the canonical strings, and a generic one for codes it does not know', () => {
    expect(errorText('INVALID_CREDENTIALS')).toBe('Email or password is incorrect.');
    expect(errorText('NOT_A_CODE' as ErrorCode)).toBe('Something went wrong.');
  });

  it('has the three join messages from API Spec A4', () => {
    expect(errorText('INVALID_JOIN_CODE')).toBe("That code didn't work. Check it and try again.");
    expect(errorText('JOIN_BLOCKED')).toBe("You can't join this class right now. Contact the instructor.");
    expect(errorText('INSTRUCTOR_CANNOT_JOIN')).toBe("Instructor accounts can't join classes.");
  });
});
