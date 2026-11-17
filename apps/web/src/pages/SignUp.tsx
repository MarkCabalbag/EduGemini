import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { MIN_PASSWORD_LENGTH, SignUpSchema, TERMS_VERSION } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { RadioGroup } from '../components/ui/RadioGroup';
import { TextField } from '../components/ui/TextField';
import { useSignUp } from '../hooks/use-auth';
import { showApiError } from '../lib/form-errors';

const ROLES = [
  { value: 'STUDENT', label: 'I am a Student' },
  { value: 'INSTRUCTOR', label: 'I am an Instructor' },
];

// The fields with an input on this form. (The Terms version is sent too, but the user never sees it.)
const SHOWN_FIELDS = ['firstName', 'lastName', 'email', 'password', 'role', 'acceptTerms'];

export function SignUp() {
  const signUp = useSignUp();
  const location = useLocation(); // where to go after signing up; handed on when the visitor switches to sign-in
  // Someone who came from a join link is a student (App Flow F2).
  const from = (location.state as { from?: unknown } | null)?.from;
  const joining = typeof from === 'string' && from.startsWith('/join/');
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(SignUpSchema),
    mode: 'onBlur',
    defaultValues: { termsVersion: TERMS_VERSION, ...(joining && { role: 'STUDENT' as const }) },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    signUp.mutate(values, { onError: (error) => showApiError(error, setError, setFormError, SHOWN_FIELDS) });
  });

  return (
    <div className="max-w-md space-y-6">
      <title>Create your account · EduGemini</title>
      <h1 className="text-display font-semibold">Create your account</h1>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField label="First name" autoComplete="given-name" {...register('firstName')} error={errors.firstName?.message} />
        <TextField label="Last name" autoComplete="family-name" {...register('lastName')} error={errors.lastName?.message} />
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          helper={`At least ${MIN_PASSWORD_LENGTH} characters`}
          {...register('password')}
          error={errors.password?.message}
        />
        <RadioGroup legend="Your role" options={ROLES} {...register('role')} error={errors.role?.message} />
        <Checkbox
          label={
            <>
              I accept the{' '}
              <Link to="/terms" target="_blank" className="text-primary underline">
                Terms
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>{' '}
              and{' '}
              <Link to="/privacy" target="_blank" className="text-primary underline">
                Privacy Notice
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </>
          }
          helper="Student work is processed by Google Gemini and reviewed by the instructor."
          {...register('acceptTerms')}
          error={errors.acceptTerms?.message}
        />
        <input type="hidden" {...register('termsVersion')} />
        <Button type="submit" loading={signUp.isPending} className="w-full">
          Create account
        </Button>
      </form>
      <p>
        Already have an account?{' '}
        <Link to="/signin" state={location.state} className="font-semibold text-primary underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
