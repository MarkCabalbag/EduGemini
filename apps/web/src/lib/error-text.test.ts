import type { ErrorCode } from '@edugemini/shared';
import { describe, expect, it } from 'vitest';
import { errorText } from './error-text';

describe('errorText', () => {
  it('uses the canonical strings, and a generic one for codes it does not know', () => {
    expect(errorText('INVALID_CREDENTIALS')).toBe('Email or password is incorrect.');
    expect(errorText('NOT_A_CODE' as ErrorCode)).toBe('Something went wrong.');
  });

  it('has the file messages from API Spec A4, and names the limit that was passed', () => {
    expect(errorText('FILE_TYPE')).toBe("This file type isn't supported. Use PDF, JPG, or PNG.");
    expect(errorText('FILE_TOO_LARGE')).toBe('This file is larger than 10 MB.');
    expect(errorText('FILE_ERROR')).toBe("This file couldn't be read. Try re-saving it or choosing a different file.");
    expect(errorText('FILE_LIMIT', { limit: 'files' })).toBe('You can upload up to 10 files.');
    expect(errorText('FILE_LIMIT', { limit: 'pages' })).toBe('This PDF has more than 20 pages.');
    expect(errorText('FILE_LIMIT', { limit: 'total-size' })).toBe('Your files add up to more than 15 MB.');
    expect(errorText('FILE_LIMIT')).toBe('Something went wrong.'); // a limit it does not know by name
  });

  it('has the key and upload messages from API Spec A4, each saying what to do next', () => {
    expect(errorText('KEY_MISSING')).toBe('Connect your Gemini key first.');
    expect(errorText('KEY_INVALID')).toBe("This key isn't valid. Check it and try again.");
    expect(errorText('KEY_API_DISABLED')).toBe("The Gemini API isn't enabled for this key.");
    expect(errorText('KEY_QUOTA')).toBe('This key has reached its daily limit.');
    expect(errorText('PROVIDER_UNAVAILABLE')).toBe("We couldn't reach Google right now. Try again in a few minutes.");
    expect(errorText('UPLOAD_NOT_OPEN')).toBe('Start a new upload to replace files.');
    expect(errorText('LOCKED_APPROVED')).toBe('This submission is locked after approval.');
  });

  it('has the locked scoring format message from API Spec A4', () => {
    expect(errorText('FORMAT_LOCKED')).toBe("Scoring can't change after submissions exist.");
  });

  it('has the three join messages from API Spec A4', () => {
    expect(errorText('INVALID_JOIN_CODE')).toBe("That code didn't work. Check it and try again.");
    expect(errorText('JOIN_BLOCKED')).toBe("You can't join this class right now. Contact the instructor.");
    expect(errorText('INSTRUCTOR_CANNOT_JOIN')).toBe("Instructor accounts can't join classes.");
  });
});
