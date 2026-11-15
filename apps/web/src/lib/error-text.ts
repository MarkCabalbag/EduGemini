import type { ErrorCode } from '@edugemini/shared';

// One lookup from an error code to what the user reads (UX Brief §11.2, API Spec A4). Components never show `message`.
const TEXT: Partial<Record<ErrorCode | 'NETWORK', string>> = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  RATE_LIMITED: 'Too many attempts. Try again in a few minutes.',
  ACCOUNT_SUSPENDED: 'Account suspended.',
  VALIDATION: 'Check the highlighted fields and try again.',
  INTERNAL: 'Something went wrong on our side.',
  SERVICE_UNAVAILABLE: "EduGemini is down for maintenance. We'll be back soon.",
  NETWORK: "You're offline. Check your connection and try again.",
};

const GENERIC = 'Something went wrong.';

export function errorText(code: ErrorCode | 'NETWORK'): string {
  return TEXT[code] ?? GENERIC;
}
