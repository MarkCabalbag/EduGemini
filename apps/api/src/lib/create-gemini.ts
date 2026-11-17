import { createFakeGemini, type GeminiAdapter } from '@edugemini/ai';
import type { Env } from './env';

/**
 * The Gemini adapter chosen by GEMINI_MODE (code-standards §5). env.ts already refuses the fake in production, so a
 * production run needs the live adapter, which arrives with spike SPK-03 (EG-KEY-03).
 */
export function createGemini(env: Pick<Env, 'GEMINI_MODE'>): GeminiAdapter {
  if (env.GEMINI_MODE === 'fake') return createFakeGemini();
  throw new Error('GEMINI_MODE=live is not built yet: the live adapter comes with spike SPK-03. Use GEMINI_MODE=fake.');
}
