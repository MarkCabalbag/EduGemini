import { z } from 'zod';
import { AppError } from './app-error';

/** A position in a list ordered by a time, then by id. The cursor is the last row of the page, so it cannot go stale. */
export type Position = { at: Date; id: string };

const encodeCursor = ({ at, id }: Position) => Buffer.from(`${at.getTime()}:${id}`).toString('base64url');

export function decodeCursor(cursor: string): Position {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const uuid = z.uuid().safeParse(id);
  const after = ms && /^\d{1,13}$/.test(ms) && uuid.success ? { at: new Date(Number(ms)), id: uuid.data } : undefined;
  // Only a cursor we made ourselves is accepted: extra segments or stray characters change the encoded form.
  if (!after || encodeCursor(after) !== cursor) {
    throw new AppError('VALIDATION', { fields: { 'query.cursor': 'That page link is not valid.' } });
  }
  return after;
}

/**
 * Cut a list read with `take: limit + 1` down to one page. The extra row only says there is a next page, which starts
 * after the position of the page's last row.
 */
export function pageOf<T>(rows: T[], limit: number, positionOf: (row: T) => Position): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, nextCursor: rows.length > limit && last ? encodeCursor(positionOf(last)) : null };
}
