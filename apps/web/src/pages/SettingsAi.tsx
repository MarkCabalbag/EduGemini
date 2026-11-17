import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { SaveKeySchema, type KeyStatus } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { TextField } from '../components/ui/TextField';
import { useMe } from '../hooks/use-auth';
import { useKey, useRemoveKey, useSaveKey } from '../hooks/use-key';
import { errorTextOf } from '../lib/error-text';
import { showApiError } from '../lib/form-errors';
import { NotFound } from './NotFound';

/** The Google AI Studio link of the setup steps (PRD FR-KEY-07). The docs name the link but not its address; this one is the owner's. */
const AI_STUDIO_URL = 'https://aistudio.google.com/docs';

const CARD = 'space-y-4 rounded-lg border border-border bg-surface p-4';

function KeyStatusCard({ status }: { status: KeyStatus }) {
  return (
    <section className={CARD}>
      {status.connected ? (
        <>
          <h2 className="text-title font-semibold">Key saved</h2>
          <p>
            Your key ends in <span className="font-mono font-semibold">{status.last4}</span>. EduGemini never shows the rest of it.
          </p>
          {status.status === null && <p className="text-muted">It has not been checked with Google yet.</p>}
        </>
      ) : (
        <>
          <h2 className="text-title font-semibold">No key saved</h2>
          <p>AI grading is off. Submissions wait for your review until you add a key.</p>
        </>
      )}
    </section>
  );
}

/** Setup help: a short numbered list a first-time user can follow in a few minutes (PRD FR-KEY-07). */
function SetupSteps() {
  return (
    <section className={CARD}>
      <h2 className="text-title font-semibold">How to get a free key</h2>
      <ol className="list-decimal space-y-2 pl-6">
        <li>
          Open{' '}
          <a href={AI_STUDIO_URL} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
            Google AI Studio
            <span className="sr-only"> (opens in a new tab)</span>
          </a>{' '}
          and sign in with a Google account.
        </li>
        <li>Create an API key and copy it.</li>
        <li>Paste it into the box above, tick &ldquo;I understand&rdquo; and save.</li>
      </ol>
    </section>
  );
}

/** The key form, and the Remove button once a key is saved (PRD FR-KEY-01, FR-KEY-04). */
function KeyForm({ status }: { status: KeyStatus }) {
  const saveKey = useSaveKey();
  const removeKey = useRemoveKey();
  const [notice, setNotice] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(SaveKeySchema),
    defaultValues: { apiKey: '', disclosureAcknowledged: false },
    mode: 'onBlur',
  });
  const { errors } = formState;
  const firstSave = !status.connected;

  const onSubmit = handleSubmit((values) => {
    setNotice(undefined);
    setFormError(undefined);
    if (firstSave && !values.disclosureAcknowledged) {
      return setError('disclosureAcknowledged', { message: 'Tick "I understand" to save your key.' });
    }
    saveKey.mutate(values, {
      onSuccess: () => {
        reset(); // the key does not stay in the box
        setNotice('Key saved.');
      },
      onError: (error) => showApiError(error, setError, setFormError, ['apiKey', 'disclosureAcknowledged']),
    });
  });

  const onRemove = () => {
    setNotice(undefined);
    setFormError(undefined);
    removeKey.mutate(undefined, {
      onSuccess: () => setNotice('Key removed. AI grading is off until you add a key.'),
      onError: (error) => setFormError(errorTextOf(error)),
      onSettled: () => setConfirmRemove(false),
    });
  };

  return (
    <section className={CARD}>
      <h2 className="text-title font-semibold">{firstSave ? 'Add your key' : 'Replace your key'}</h2>
      {notice && <Alert variant="info">{notice}</Alert>}
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {firstSave && (
          <p>
            Student work is sent to Google Gemini under your key. On Google&rsquo;s free tier, Google may use that content to improve its
            products. Paid-tier terms are different, so check Google&rsquo;s current terms before you save a key.
          </p>
        )}
        <TextField
          label="Gemini API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          {...register('apiKey')}
          error={errors.apiKey?.message}
        />
        {firstSave && <Checkbox label="I understand" {...register('disclosureAcknowledged')} error={errors.disclosureAcknowledged?.message} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saveKey.isPending}>
            {firstSave ? 'Save key' : 'Replace key'}
          </Button>
          {!firstSave && (
            <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
              Remove key
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove your Gemini key?"
        description="AI grading stops for all your assignments, and new submissions wait for your review. You can add a key again at any time."
        confirmLabel="Remove key"
        onConfirm={onRemove}
        pending={removeKey.isPending}
      />
    </section>
  );
}

function KeyPage() {
  const key = useKey();
  if (key.isPending) return <PageLoading />;
  if (key.isError) return <ErrorState error={key.error} onRetry={() => void key.refetch()} />;
  return (
    <div className="space-y-4">
      <title>Gemini key · EduGemini</title>
      <h1 className="text-display font-semibold">Gemini key</h1>
      <KeyStatusCard status={key.data} />
      <KeyForm status={key.data} />
      <SetupSteps />
    </div>
  );
}

/** Settings > AI (instructors only, TRD §15.1). The API refuses everyone else too; this keeps a student from getting the page. */
export function SettingsAi() {
  const me = useMe().data;
  return me?.role === 'INSTRUCTOR' ? <KeyPage /> : <NotFound />;
}
