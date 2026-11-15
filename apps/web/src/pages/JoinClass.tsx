import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { JoinSchema, type JoinResult } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useJoinClass } from '../hooks/use-classes';
import { showApiError } from '../lib/form-errors';

/** What the student reads after a join that worked. A removed student never gets here: the API refuses them. */
export function joinedText({ className, status }: JoinResult) {
  if (status === 'ACTIVE') return `You joined ${className}.`;
  if (status === 'PENDING') return `${className}: Pending approval. Your instructor will review your request.`;
  return `Your request to join ${className} was declined.`;
}

/** The student's code box (App Flow §6 step 1, UX Brief §9.4). */
export function JoinClass() {
  const join = useJoinClass();
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, reset, formState } = useForm({ resolver: zodResolver(JoinSchema), mode: 'onBlur' });

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    join.mutate(values, {
      onSuccess: () => reset(),
      onError: (error) => showApiError(error, setError, setFormError, ['code']),
    });
  });

  return (
    <section className="space-y-4">
      <h2 className="text-title font-semibold">Join a class</h2>
      {formError && <Alert>{formError}</Alert>}
      {join.data && <Alert variant="info">{joinedText(join.data)}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {/* Shown in capitals as it is typed. The schema makes the value sent capitals too, so a phone's autocorrect cannot matter. */}
        <div className="[&_input]:uppercase">
          <TextField
            label="Class code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            helper="Ask your instructor for the class code."
            {...register('code')}
            error={formState.errors.code?.message}
          />
        </div>
        <Button type="submit" loading={join.isPending}>
          Join class
        </Button>
      </form>
    </section>
  );
}
