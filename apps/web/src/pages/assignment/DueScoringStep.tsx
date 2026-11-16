import { useForm } from 'react-hook-form';
import type { ScoringFormat } from '@edugemini/shared';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { timeZoneOptions, toInstant, toLocalInput } from '../../lib/zoned-time';
import { StepForm, type StepProps } from './StepForm';
import { useStepSave } from './use-step-save';

// The due date is typed on a clock, in the zone chosen beside it. The max score is kept as typed and checked only for points.
type Values = { dueLocal: string; timezone: string; scoringFormat: ScoringFormat; maxScore: string };

const FORMATS: { value: ScoringFormat; label: string }[] = [
  { value: 'POINTS', label: 'Points (for example 42 / 50)' },
  { value: 'PERCENTAGE', label: 'Percentage (for example 84%)' },
  { value: 'LETTER_NUMERIC', label: 'Letter and number (for example B+ / 87)' },
];

/** Step 3: when it is due and how it is scored. The format cannot change once a submission exists, which comes with the submission tickets (A13). */
export function DueScoringStep({ assignment, onSaved, onBack }: StepProps) {
  const { register, handleSubmit, setError, watch, formState } = useForm<Values>({
    mode: 'onBlur',
    defaultValues: {
      dueLocal: toLocalInput(assignment.dueAt, assignment.timezone),
      timezone: assignment.timezone,
      scoringFormat: assignment.scoringFormat,
      maxScore: String(assignment.maxScore),
    },
  });
  // The due date itself is not a field the API names back, so a problem it finds in it is said above the form.
  const { save, saving, formError } = useStepSave(assignment.id, setError, ['timezone', 'scoringFormat', 'maxScore'], onSaved);
  const { errors } = formState;
  const points = watch('scoringFormat') === 'POINTS';

  return (
    <StepForm
      onSubmit={handleSubmit((v) =>
        save({
          dueAt: toInstant(v.dueLocal, v.timezone),
          timezone: v.timezone,
          scoringFormat: v.scoringFormat,
          ...(v.scoringFormat === 'POINTS' && { maxScore: Number(v.maxScore) }),
        }),
      )}
      saving={saving}
      formError={formError}
      onBack={onBack}
    >
      <TextField
        label="Due date and time"
        type="datetime-local"
        {...register('dueLocal', { required: 'Enter a due date and time' })}
        error={errors.dueLocal?.message}
      />
      <SelectField
        label="Time zone"
        {...register('timezone')}
        error={errors.timezone?.message}
        helper="The due date and time above are on the clock of this time zone. Students see them in their own."
      >
        {timeZoneOptions(assignment.timezone).map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </SelectField>
      <SelectField label="Scoring format" {...register('scoringFormat')} error={errors.scoringFormat?.message}>
        {FORMATS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      {points ? (
        <TextField
          label="Max score"
          type="number"
          step="any"
          inputMode="decimal"
          {...register('maxScore', {
            validate: (value) => (Number(value) >= 0.01 && Number(value) <= 1000) || 'Use a number from 0.01 to 1000',
          })}
          error={errors.maxScore?.message}
        />
      ) : (
        <p>Scored out of 100.</p>
      )}
    </StepForm>
  );
}
