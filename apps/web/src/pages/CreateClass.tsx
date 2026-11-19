import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { CreateClassSchema } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { TextAreaField } from '../components/ui/TextAreaField';
import { TextField } from '../components/ui/TextField';
import { useCreateClass } from '../hooks/use-classes';
import { usePaperPage } from '../hooks/use-paper-page';
import { showApiError } from '../lib/form-errors';
import { PAPER_HEADING } from '../lib/paper';

const SHOWN_FIELDS = ['name', 'description', 'section', 'subject', 'room', 'attestation.confirmed'];

// The full sentence, in view and not behind a link (UX Brief §9.3). The words are from App Flow §4 step 1.
const ATTESTATION =
  "I have the authority to collect and upload my students' work, and my students (or their guardians where required) have been told it is processed by AI.";

export function CreateClass() {
  usePaperPage();
  const navigate = useNavigate();
  const createClass = useCreateClass();
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, watch, formState } = useForm({
    resolver: zodResolver(CreateClassSchema),
    mode: 'onBlur',
  });
  const { errors } = formState;
  const attested = watch('attestation.confirmed');

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    createClass.mutate(values, {
      onSuccess: (created) => void navigate(`/classes/${created.id}`),
      onError: (error) => showApiError(error, setError, setFormError, SHOWN_FIELDS),
    });
  });

  return (
    // On the Marked Script paper: every block is a whole number of 36 px rows, so the text sits on the ruled lines.
    <div className="pl-6 leading-9 sm:pl-12">
      <title>Create class · EduGemini</title>
      <Link to="/classes" className="flex h-9 w-max items-center gap-1.5 font-semibold text-primary underline underline-offset-4">
        <ArrowLeft aria-hidden size={16} />
        My classes
      </Link>
      <h1 className={PAPER_HEADING}>Create class</h1>
      {formError && (
        <div className="mb-[18px] max-w-[47.5rem]">
          <Alert>{formError}</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="max-w-[47.5rem] space-y-[18px]">
        <TextField label="Class name" {...register('name')} error={errors.name?.message} />
        <TextAreaField label="Description (optional)" rows={5} {...register('description')} error={errors.description?.message} />
        <div className="grid gap-x-3 gap-y-[18px] sm:grid-cols-[2fr_1fr_1fr]">
          <TextField label="Section (optional)" {...register('section')} error={errors.section?.message} />
          <TextField label="Subject (optional)" {...register('subject')} error={errors.subject?.message} />
          <TextField label="Room (optional)" {...register('room')} error={errors.room?.message} />
        </div>
        <Checkbox
          label={ATTESTATION}
          {...register('attestation.confirmed')}
          error={errors.attestation?.confirmed?.message ?? errors.attestation?.message}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-[18px] pt-[18px]">
          <Button
            type="submit"
            loading={createClass.isPending}
            disabled={!attested}
            aria-describedby={attested ? undefined : 'create-class-hint'}
          >
            Create class
          </Button>
          <Link to="/classes" className={buttonClass('secondary')}>
            Cancel
          </Link>
          {/* Says why the button is off, for people who cannot see that it is greyed out. */}
          {!attested && (
            <p id="create-class-hint" className="ml-2 text-[0.875rem] leading-9 text-muted">
              Confirm the statement above to create the class.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
