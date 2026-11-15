import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { SignInSchema } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useSignIn } from '../hooks/use-auth';
import { showApiError } from '../lib/form-errors';

export function SignIn() {
  const signIn = useSignIn();
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
    <div className="max-w-md space-y-6">
      <h1 className="text-display font-semibold">Sign in</h1>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
          error={errors.password?.message}
        />
        <Button type="submit" loading={signIn.isPending} className="w-full">
          Sign in
        </Button>
      </form>
      <p>
        New here?{' '}
        <Link to="/signup" className="font-semibold text-primary underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
