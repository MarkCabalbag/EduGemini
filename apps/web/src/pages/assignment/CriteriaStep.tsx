import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { RequiredCriteriaSchema } from '@edugemini/shared';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { ReferenceFiles } from './ReferenceFiles';
import { StepForm, type StepProps } from './StepForm';
import { useStepSave } from './use-step-save';

/** Step 2: the free-text criteria Gemini grades against, and the reference files that go with them (ASG-07). */
export function CriteriaStep({ assignment, onSaved, onBack }: StepProps) {
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(RequiredCriteriaSchema),
    mode: 'onBlur',
    defaultValues: { criteriaText: assignment.criteriaText },
  });
  const { save, saving, formError } = useStepSave(assignment.id, setError, ['criteriaText'], onSaved);

  return (
    <StepForm onSubmit={handleSubmit(save)} saving={saving} formError={formError} onBack={onBack}>
      <TextAreaField
        label="Grading criteria"
        rows={8}
        {...register('criteriaText')}
        error={formState.errors.criteriaText?.message}
        helper='Plain language works best. Example: "Thesis is clear (10 points)." Students do not see this.'
      />
      <ReferenceFiles assignment={assignment} canChange />
    </StepForm>
  );
}
