import { describe, expect, it } from 'vitest';
import { createGemini } from './create-gemini';

describe('createGemini', () => {
  it('gives the live adapter with the configured model by default', () => {
    expect(createGemini({ GEMINI_MODE: 'live', GEMINI_MODEL: 'gemini-2.5-flash' }).model).toBe('gemini-2.5-flash');
  });

  it('gives the fake adapter only when the end-to-end tests ask for it', () => {
    expect(createGemini({ GEMINI_MODE: 'fake', GEMINI_MODEL: 'gemini-2.5-flash' }).model).toBe('fake');
  });
});
