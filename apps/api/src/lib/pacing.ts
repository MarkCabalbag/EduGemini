// Gemini calls per minute for one instructor's key. A conservative start until spike S3 measures the real limit (TRD §10.2, §11).
export const GEMINI_CALLS_PER_MINUTE = 5;

export type Pacer = {
  /** Take a token for this instructor's key: 0 means go ahead, anything else is the seconds to wait for the next token. */
  take(instructorId: string): number;
};

/**
 * One token bucket per instructor, in memory (TRD §10.2). That is correct because the worker is one process (TRD §3). A bucket
 * starts full, so a class can send `perMinute` grades at once, then one more every 60 / `perMinute` seconds.
 */
export function createPacer({ perMinute = GEMINI_CALLS_PER_MINUTE, now = Date.now }: { perMinute?: number; now?: () => number } = {}): Pacer {
  const msPerToken = 60_000 / perMinute;
  const buckets = new Map<string, { tokens: number; at: number }>();

  return {
    take(instructorId) {
      const time = now();
      const bucket = buckets.get(instructorId) ?? { tokens: perMinute, at: time };
      bucket.tokens = Math.min(perMinute, bucket.tokens + (time - bucket.at) / msPerToken);
      bucket.at = time;
      buckets.set(instructorId, bucket);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return 0;
      }
      return Math.ceil(((1 - bucket.tokens) * msPerToken) / 1000);
    },
  };
}
