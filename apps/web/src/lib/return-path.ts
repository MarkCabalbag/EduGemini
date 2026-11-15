const FALLBACK = '/classes';
const BASE = 'http://app.invalid';

/**
 * Where to go after signing in. Only a path inside this app is allowed, so a crafted link cannot send
 * someone to another site (TRD §6.4). Anything else goes to the dashboard.
 * The browser's own URL parsing decides what is "inside", so tricks like "/\t/evil.com" or "/\evil.com" cannot slip past.
 */
export function safeReturnPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/')) return FALLBACK;
  const url = new URL(path, BASE);
  if (url.origin !== BASE) return FALLBACK;
  if (url.pathname === '/signin' || url.pathname === '/signup') return FALLBACK;
  return url.pathname + url.search + url.hash;
}
