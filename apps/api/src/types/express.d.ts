import type { Logger } from '../lib/logger';

declare global {
  namespace Express {
    // Declaration merging needs an interface.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Request {
      /** Request ID, also sent as X-Request-Id. */
      id: string;
      /** Logger bound to the request ID. */
      log: Logger;
    }
  }
}

export {};
