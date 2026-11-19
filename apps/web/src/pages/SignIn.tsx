import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { SignInSchema } from '@edugemini/shared';
import { MarkedScriptPage } from '../components/MarkedScriptPage';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useSignIn } from '../hooks/use-auth';
import { showApiError } from '../lib/form-errors';

export function SignIn() {
  const signIn = useSignIn();
  const location = useLocation(); // where to go after signing in; handed on when the visitor switches to sign-up
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(SignInSchema),
    mode: 'onBlur',
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    signIn.mutate(values, { onError: (error) => showApiError(error, setError, setFormError, ['email', 'password']) });
  });

  return (
    <MarkedScriptPage>
      <title>Sign in · EduGemini</title>
      <h1 className="text-[2.5rem] leading-[72px] font-bold tracking-tight">Sign in</h1>
      {formError && (
        <div className="mb-[18px]">
          <Alert>{formError}</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-[18px]">
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          {...register('email')}
          error={errors.email?.message}
        />
        <TextField
          label="Password"
          type="password"
          revealable
          autoComplete="current-password"
          {...register('password')}
          error={errors.password?.message}
        />
        <Button type="submit" loading={signIn.isPending} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-[18px]">
        New here?{' '}
        <Link to="/signup" state={location.state} className="font-semibold text-primary underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </MarkedScriptPage>
  );
}
