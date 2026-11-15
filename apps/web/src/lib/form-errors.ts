import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from './api';
import { errorText } from './error-text';

/**
 * Shows a failed API call on a form. Field problems go under their field. Anything else, including a problem with
 * a field the form has no input for (`shownFields` lists the ones it has), goes in `setFormError`, the message above the form.
 */
export function showApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  setFormError: (message: string) => void,
  shownFields: string[],
) {
  if (!(error instanceof ApiRequestError)) return setFormError(errorText('INTERNAL'));
  if (error.code === 'EMAIL_TAKEN') return setError('email' as Path<T>, { message: errorText('EMAIL_TAKEN') });
  if (error.code === 'VALIDATION' && error.fields) {
    for (const [name, message] of Object.entries(error.fields)) {
      if (shownFields.includes(name)) setError(name as Path<T>, { message });
      else setFormError(message);
    }
    return;
  }
  setFormError(errorText(error.code));
}
