import { useForm } from 'react-hook-form';
import { Checkbox } from '../../components/ui/Checkbox';
import { SelectField } from '../../components/ui/SelectField';
import { StepForm, type StepProps } from './StepForm';
import { useStepSave } from './use-step-save';

const UNLIMITED = 'unlimited';
const LIMITS = [...Array.from({ length: 11 }, (_, n) => String(n)), UNLIMITED]; // 0 to 10, or Unlimited (PRD FR-ASG-10)

/** Step 4: how many resubmissions, and whether late work is accepted. Both are stored now; the submission tickets enforce them. */
export function RulesStep({ assignment, onSaved, onBack }: StepProps) {
  const { register, handleSubmit, setError } = useForm({
    defaultValues: {
      limit: assignment.maxResubmissions === null ? UNLIMITED : String(assignment.maxResubmissions),
      acceptLate: assignment.acceptLate,
    },
  });
  const { save, saving, formError } = useStepSave(assignment.id, setError, [], onSaved);

  return (
    <StepForm
      onSubmit={handleSubmit((v) => save({ maxResubmissions: v.limit === UNLIMITED ? null : Number(v.limit), acceptLate: v.acceptLate }))}
      saving={saving}
      formError={formError}
      onBack={onBack}
    >
      <SelectField
        label="Resubmissions allowed after the first submission"
        {...register('limit')}
        helper="Students can resubmit until you approve their grade."
      >
        {LIMITS.map((value) => (
          <option key={value} value={value}>
            {value === UNLIMITED ? 'Unlimited' : value}
          </option>
        ))}
      </SelectField>
      <Checkbox
        label="Accept late submissions"
        {...register('acceptLate')}
        helper="Late work is accepted and marked Late. Turn this off to block uploads after the due date."
      />
    </StepForm>
  );
}
