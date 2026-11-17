import { LIMITS, MiB, type ErrorCode } from '@edugemini/shared';
import { ApiRequestError } from './api';

// One lookup from an error code to what the user reads (UX Brief §11.2, API Spec A4). Components never show `message`.
const TEXT: Partial<Record<ErrorCode | 'NETWORK', string>> = {
  UPLOAD_INCOMPLETE: "Some files haven't finished uploading.",
  ATTEMPTS_EXHAUSTED: "You've used all your resubmissions. Your instructor can give you more.",
  LATE_CLOSED: 'Late submissions are closed for this assignment.',
  FORMAT_LOCKED: "Scoring can't change after submissions exist.",
  FILE_TYPE: "This file type isn't supported. Use PDF, JPG, or PNG.",
  FILE_TOO_LARGE: 'This file is larger than 10 MB.',
  FILE_ERROR: "This file couldn't be read. Try re-saving it or choosing a different file.",
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  RATE_LIMITED: 'Too many attempts. Try again in a few minutes.',
  ACCOUNT_SUSPENDED: 'Account suspended.',
  INVALID_JOIN_CODE: "That code didn't work. Check it and try again.",
  JOIN_BLOCKED: "You can't join this class right now. Contact the instructor.",
  INSTRUCTOR_CANNOT_JOIN: "Instructor accounts can't join classes.",
  CLASS_ARCHIVED: 'This class is archived and read-only.',
  CONFLICT: 'That changed in the meantime. The list has been updated.',
  VALIDATION: 'Check the highlighted fields and try again.',
  INTERNAL: 'Something went wrong on our side.',
  SERVICE_UNAVAILABLE: "EduGemini is down for maintenance. We'll be back soon.",
  NETWORK: "You're offline. Check your connection and try again.",
};

const GENERIC = 'Something went wrong.';

/** `details` is the error's own, for the codes whose text depends on it: FILE_LIMIT names the limit that was passed (API Spec A4). */
export function errorText(code: ErrorCode | 'NETWORK', details?: Record<string, unknown>): string {
  if (code === 'FILE_LIMIT') {
    if (details?.['limit'] === 'files') return `You can upload up to ${LIMITS.filesPerSubmission} files.`;
    if (details?.['limit'] === 'pages') return `This PDF has more than ${LIMITS.maxPdfPages} pages.`;
    if (details?.['limit'] === 'total-size') return `Your files add up to more than ${LIMITS.maxSubmissionBytes / MiB} MB.`;
    if (details?.['limit'] === 'grading-budget') return 'These files are too large to grade together. Remove one and try again.';
  }
  return TEXT[code] ?? GENERIC;
}

/** The text for anything a request threw: an API error by its code, anything else as an internal error. */
export const errorTextOf = (error: unknown): string =>
  error instanceof ApiRequestError ? errorText(error.code, error.details) : errorText('INTERNAL');
