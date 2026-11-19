import { resolve } from 'node:path';

// Where the end-to-end run lives. Its own ports, so it can run while `pnpm dev:api` and `pnpm dev:web` are up.
export const API_PORT = 4100;
export const WEB_PORT = 5273;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Loads the repository's .env when it exists. CI sets the variables directly. Values are never printed. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
