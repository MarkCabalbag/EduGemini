import { createFakeGemini, createLiveGemini, type GeminiAdapter } from '@edugemini/ai';
import type { Env } from './env';

/** The app's Gemini adapter: the live one, unless the end-to-end tests asked for the fake (env.ts refuses it in production). */
export function createGemini(env: Pick<Env, 'GEMINI_MODE' | 'GEMINI_MODEL'>): GeminiAdapter {
  return env.GEMINI_MODE === 'fake' ? createFakeGemini() : createLiveGemini(env.GEMINI_MODEL);
}
