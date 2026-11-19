import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startKeepAlive } from './keep-alive';

const logger = { debug: vi.fn(), warn: vi.fn() } as unknown as Parameters<typeof startKeepAlive>[1];

describe('startKeepAlive', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks for /healthz on the public address every 10 minutes, and stops when told to', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200 });
    const stop = startKeepAlive('https://edugemini.onrender.com', logger, fetchFn as unknown as typeof fetch);

    expect(fetchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://edugemini.onrender.com/healthz');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('logs a failed ping and tries again at the next one', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue({ status: 200 });
    const stop = startKeepAlive('https://edugemini.onrender.com', logger, fetchFn as unknown as typeof fetch);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    stop();
  });
});
