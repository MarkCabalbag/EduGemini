import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Me, SignIn, SignUp } from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import { isCommonPassword } from './common-passwords';
import { ME_SELECT, toMe } from './me';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { createSession, newSession } from './session';

export type SignedIn = { me: Me; token: string };

export async function signUp(db: PrismaClient, input: SignUp): Promise<SignedIn> {
  if (isCommonPassword(input.password)) {
    throw new AppError('VALIDATION', { fields: { password: 'That password is too common. Choose another.' } });
  }

  const passwordHash = await hashPassword(input.password);
  const { token, data: session } = newSession();
  try {
    // The user and the session are written together, so a failure never leaves an account without its first sign-in.
    const user = await db.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        termsAcceptedAt: new Date(),
        termsVersion: input.termsVersion,
        sessions: { create: session },
      },
      select: ME_SELECT,
    });
    return { me: toMe(user), token };
  } catch (error) {
    // The unique index on email is the source of truth, so two sign-ups racing cannot both win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('EMAIL_TAKEN');
    }
    throw error;
  }
}

export async function signIn(db: PrismaClient, input: SignIn, log: Logger): Promise<SignedIn> {
  const user = await db.user.findUnique({ where: { email: input.email }, select: ME_SELECT });

  // An unknown email costs the same time as a wrong password and gets the same answer (TRD §14).
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password, log)
    : await verifyAgainstDummy(input.password);
  if (!user || !passwordOk) throw new AppError('INVALID_CREDENTIALS');

  // Checked only after the password, so a stranger cannot learn that an account is suspended.
  if (user.suspendedAt) throw new AppError('ACCOUNT_SUSPENDED');

  return { me: toMe(user), token: await createSession(db, user.id) };
}
