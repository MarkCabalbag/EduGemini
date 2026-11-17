import { Prisma } from '@prisma/client';

/** A unique index refused the write (Prisma P2002): another request got there first, or the value is taken. */
export const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
