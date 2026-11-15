import { z } from 'zod';

/**
 * Every API error code and its HTTP status (API Spec A4). Adding a code is an additive change:
 * update the A4 table and the ErrorCode enum in docs/openapi.yaml in the same change. A test keeps the three in step.
 */
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  VALIDATION: 400,
  PASSWORD_INCORRECT: 400,
  TOKEN_INVALID: 400,
  CONFIRMATION_MISMATCH: 400,
  CONFIRMATION_REQUIRED: 422,
  CONFIRMATION_STALE: 409,
  ACCOUNT_SUSPENDED: 403,
  ENROLLMENT_PENDING: 403,
  JOIN_BLOCKED: 403,
  INSTRUCTOR_CANNOT_JOIN: 403,
  CSRF_ORIGIN: 403,
  NOT_FOUND: 404,
  INVALID_JOIN_CODE: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  LOCKED_APPROVED: 409,
  ATTEMPTS_EXHAUSTED: 409,
  LATE_CLOSED: 409,
  FORMAT_LOCKED: 409,
  CLASS_ARCHIVED: 409,
  KEY_MISSING: 422,
  GRADE_PENDING_EXISTS: 409,
  NOT_REGRADABLE: 409,
  UPLOAD_NOT_OPEN: 409,
  UPLOAD_INCOMPLETE: 409,
  ALREADY_APPROVED: 409,
  LABEL_EXISTS: 409,
  FILE_TYPE: 415,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  FILE_LIMIT: 422,
  FILE_ERROR: 422,
  KEY_INVALID: 422,
  KEY_API_DISABLED: 422,
  KEY_QUOTA: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ErrorCodeSchema = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

/** The one error response shape (API Spec A4). `code` is the only field the UI branches on. */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
