import type { Logger } from './logger';

// Render's free plan puts a web service to sleep after 15 minutes without a request from outside. A request to the service's own
// public address counts, so one every 10 minutes keeps it awake while it runs (the sleeping service itself cannot do this: a
// service that is already asleep is woken only by an outside request, such as a visitor).
const KEEP_ALIVE_EVERY_MS = 10 * 60_000;

/**
 * Starts the keep-alive: `GET <publicUrl>/healthz` every 10 minutes. Returns a function that stops it. A failed ping is only
 * logged; the next one tries again.
 */
export function startKeepAlive(publicUrl: string, logger: Logger, fetchFn: typeof fetch = fetch): () => void {
  const target = new URL('/healthz', publicUrl).toString();
  const timer = setInterval(() => {
    fetchFn(target, { signal: AbortSignal.timeout(30_000) })
      .then((res) => logger.debug({ event: 'keep_alive.ping', status: res.status }))
      .catch((error: unknown) => logger.warn({ event: 'keep_alive.failed', err: error }));
  }, KEEP_ALIVE_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
