import type { Prisma } from '@prisma/client';
import type { Me } from '@edugemini/shared';

/** The user columns needed to build `Me`. The password hash is read only to learn whether one exists. */
export const ME_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  emailVerifiedAt: true,
  passwordHash: true,
  suspendedAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof ME_SELECT }>;

export function toMe(user: UserRow): Me {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    suspended: user.suspendedAt !== null,
  };
}
