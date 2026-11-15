import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../lib/logger';

/** First in the chain: every response carries X-Request-Id, and every log line can be tied to it. */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    req.id = randomUUID();
    req.log = logger.child({ requestId: req.id });
    res.setHeader('X-Request-Id', req.id);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      // Path only: query strings can carry tokens. No bodies are logged.
      req.log.info({ event: 'http.request', method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  };
}
