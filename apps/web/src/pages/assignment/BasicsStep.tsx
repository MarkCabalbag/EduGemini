import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { CreateAssignmentSchema, type CreateAssignment } from '@edugemini/shared';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { StepForm, type StepProps } from './StepForm';
import { useStepSave } from './use-step-save';

/** Step 1: title and instructions (App Flow §5.1). Labels are a Could item, so there is no label field yet. */
export const BasicsSchema = CreateAssignmentSchema.pick({ title: true, instructions: true });
export type BasicsValues = Pick<CreateAssignment, 'title' | 'instructions'>;

/** The two fields, shared by the form that makes the draft and the step that edits it. */
export function BasicsFields({ register, errors }: { register: UseFormRegister<BasicsValues>; errors: FieldErrors<BasicsValues> }) {
  return (
    <>
      <TextField label="Title" {...register('title')} error={errors.title?.message} />
      <TextAreaField
        label="Instructions (optional)"
        rows={5}
        {...register('instructions')}
        error={errors.instructions?.message}
        helper="What students should do. Students see this."
      />
    </>
  );
}

export function BasicsStep({ assignment, onSaved, submitLabel }: StepProps) {
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(BasicsSchema),
    mode: 'onBlur',
    defaultValues: { title: assignment.title, instructions: assignment.instructions ?? '' },
  });
  const { save, saving, formError } = useStepSave(assignment.id, setError, ['title', 'instructions'], onSaved);

  return (
    <StepForm onSubmit={handleSubmit(save)} saving={saving} formError={formError} submitLabel={submitLabel}>
      <BasicsFields register={register} errors={formState.errors} />
    </StepForm>
  );
}
