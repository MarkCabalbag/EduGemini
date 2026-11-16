import { useState } from 'react';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import type { UpdateAssignment } from '@edugemini/shared';
import { useUpdateAssignment } from '../../hooks/use-assignments';
import { showApiError } from '../../lib/form-errors';

/**
 * Saves one step's fields to the draft (the autosave of App Flow F15), then calls `then`. What the API refuses is shown on
 * the form: under a field in `shownFields`, or above the form for anything else.
 */
export function useStepSave<T extends FieldValues>(
  assignmentId: string,
  setError: UseFormSetError<T>,
  shownFields: string[],
  then: () => void,
) {
  const update = useUpdateAssignment(assignmentId);
  const [formError, setFormError] = useState<string>();

  const save = (changes: UpdateAssignment) => {
    setFormError(undefined);
    update.mutate(changes, { onSuccess: then, onError: (error) => showApiError(error, setError, setFormError, shownFields) });
  };
  return { save, saving: update.isPending, formError };
}
