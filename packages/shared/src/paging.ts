import { z } from 'zod';

/** The `cursor` and `limit` query of every list (API Spec A2). The cursor is opaque to callers. `limit` is a plain whole number, 1 to 100, default 25. */
export const PageQuery = {
  cursor: z.string().min(1).max(200).optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'Use a whole number from 1 to 100')
    .transform(Number)
    .pipe(z.number().min(1, 'Use a whole number from 1 to 100').max(100, 'Use a whole number from 1 to 100'))
    .default(25),
};
