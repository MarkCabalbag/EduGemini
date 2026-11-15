import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { createQueryClient, meKeys } from './query-client';

const ME = { id: '1', firstName: 'Ada' };

describe('createQueryClient', () => {
  it('forgets the signed-in user when any call answers 401', async () => {
    const client = createQueryClient();
    client.setQueryData(meKeys.all, ME);

    await client
      .fetchQuery({
        queryKey: ['classes'],
        queryFn: () => Promise.reject(new ApiRequestError('UNAUTHENTICATED', 401)),
      })
      .catch(() => undefined);

    expect(client.getQueryData(meKeys.all)).toBeNull();
  });

  it('also drops everything else cached when a call answers 401', async () => {
    const client = createQueryClient();
    client.setQueryData(['classes'], ['Biology 101']);

    await client
      .fetchQuery({ queryKey: ['assignments'], queryFn: () => Promise.reject(new ApiRequestError('UNAUTHENTICATED', 401)) })
      .catch(() => undefined);

    expect(client.getQueryData(['classes'])).toBeUndefined();
  });

  it('keeps the user when a call fails for another reason', async () => {
    const client = createQueryClient();
    client.setQueryData(meKeys.all, ME);

    await client
      .fetchQuery({ queryKey: ['classes'], queryFn: () => Promise.reject(new ApiRequestError('NOT_FOUND', 404)) })
      .catch(() => undefined);

    expect(client.getQueryData(meKeys.all)).toEqual(ME);
  });

  it('does not retry a 4xx answer, and retries a server failure twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ApiRequestError('NOT_FOUND', 404))).toBe(false);
    expect(retry(0, new ApiRequestError('INTERNAL', 500))).toBe(true);
    expect(retry(1, new ApiRequestError('NETWORK', 0))).toBe(true);
    expect(retry(2, new ApiRequestError('INTERNAL', 500))).toBe(false);
  });
});
