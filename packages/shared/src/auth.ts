import { z } from 'zod';
import { RoleSchema } from './enums';

export const MIN_PASSWORD_LENGTH = 10;

/** The Terms version users accept. Change it whenever the Terms text changes (placeholder until EG-DEMO-05). */
export const TERMS_VERSION = '2026-11-draft';
const MAX_PASSWORD_LENGTH = 128;
export const MAX_EMAIL_LENGTH = 320;

const email = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_LENGTH));
const name = z.string().trim().min(1, 'Required').max(100);

/** Sign-up (API Spec AUTH-01). Role is chosen once and cannot change (PRD A6). */
export const SignUpSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(MAX_PASSWORD_LENGTH),
  firstName: name,
  lastName: name,
  role: z.enum(['STUDENT', 'INSTRUCTOR'], { error: 'Choose a role' }),
  acceptTerms: z.literal(true, { error: 'You must accept the Terms to continue' }),
  termsVersion: z.literal(TERMS_VERSION, { error: 'The Terms have changed. Reload the page and try again.' }),
});
export type SignUp = z.infer<typeof SignUpSchema>;

/** Sign-in (API Spec AUTH-02). No length rules here: a wrong password is just a wrong password. */
export const SignInSchema = z.object({
  email,
  password: z.string().min(1, 'Required').max(MAX_PASSWORD_LENGTH),
});
export type SignIn = z.infer<typeof SignInSchema>;

/** The signed-in user (API Spec A5). `preferences` joins this with the settings tickets. */
export const MeSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: RoleSchema,
  emailVerified: z.boolean(),
  suspended: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;
