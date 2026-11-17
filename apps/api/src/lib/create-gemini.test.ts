import { describe, expect, it } from 'vitest';
import { createGemini } from './create-gemini';

describe('createGemini', () => {
  it('gives the fake adapter for GEMINI_MODE=fake', () => {
    expect(createGemini({ GEMINI_MODE: 'fake' }).model).toBe('fake');
  });

  it('refuses GEMINI_MODE=live until the live adapter exists, and says so', () => {
    expect(() => createGemini({ GEMINI_MODE: 'live' })).toThrow(/not built yet/);
  });
});
