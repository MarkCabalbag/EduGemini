import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { CreateClassSchema } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { TextAreaField } from '../components/ui/TextAreaField';
import { TextField } from '../components/ui/TextField';
import { useMe } from '../hooks/use-auth';
import { useCreateClass } from '../hooks/use-classes';
import { showApiError } from '../lib/form-errors';
import { NotFound } from './NotFound';

const SHOWN_FIELDS = ['name', 'description', 'section', 'subject', 'room', 'attestation.confirmed'];

// The full sentence, in view and not behind a link (UX Brief §9.3). The words are from App Flow §4 step 1.
const ATTESTATION =
  "I have the authority to collect and upload my students' work, and my students (or their guardians where required) have been told it is processed by AI.";

export function CreateClass() {
  const me = useMe().data;
  const navigate = useNavigate();
  const createClass = useCreateClass();
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, watch, formState } = useForm({
    resolver: zodResolver(CreateClassSchema),
    mode: 'onBlur',
  });
  const { errors } = formState;
  const attested = watch('attestation.confirmed');

  // The API refuses everyone else too; this just keeps the form from showing to a student (API Spec A3).
  if (me?.role !== 'INSTRUCTOR') return <NotFound />;

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    createClass.mutate(values, {
      onSuccess: (created) => void navigate(`/classes/${created.id}`),
      onError: (error) => showApiError(error, setError, setFormError, SHOWN_FIELDS),
    });
  });

  return (
    <div className="max-w-xl space-y-6">
      <title>Create class · EduGemini</title>
      <h1 className="text-display font-semibold">Create class</h1>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField label="Class name" {...register('name')} error={errors.name?.message} />
        <TextAreaField label="Description (optional)" {...register('description')} error={errors.description?.message} />
        <TextField label="Section (optional)" {...register('section')} error={errors.section?.message} />
        <TextField label="Subject (optional)" {...register('subject')} error={errors.subject?.message} />
        <TextField label="Room (optional)" {...register('room')} error={errors.room?.message} />
        <Checkbox
          label={ATTESTATION}
          {...register('attestation.confirmed')}
          error={errors.attestation?.confirmed?.message ?? errors.attestation?.message}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            loading={createClass.isPending}
            disabled={!attested}
            aria-describedby={attested ? undefined : 'create-class-hint'}
          >
            Create class
          </Button>
          <Link to="/classes" className="font-semibold text-primary underline">
            Cancel
          </Link>
          {/* Says why the button is off, for people who cannot see that it is greyed out. */}
          {!attested && (
            <p id="create-class-hint" className="text-small text-muted">
              Confirm the statement above to create the class.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
