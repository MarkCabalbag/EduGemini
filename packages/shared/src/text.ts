import { z } from 'zod';

/**
 * Trimmed text with a length limit. The database path cannot take a NUL character or a lone UTF-16 surrogate (half of an
 * emoji), so both are refused here instead of failing later as a server error. A whole emoji is fine.
 */
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes('\u0000') && !/\p{Surrogate}/u.test(value), 'This contains a character that is not allowed');
