import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useCreateAssignment } from '../../hooks/use-assignments';
import { showApiError } from '../../lib/form-errors';
import { browserTimeZone } from '../../lib/zoned-time';
import { BasicsFields, BasicsSchema } from './BasicsStep';
import { WizardFrame } from './WizardFrame';

/**
 * Step 1 of a new assignment. Continuing makes the draft, which is saved from then on, so leaving the wizard never loses
 * progress (App Flow §5.1, F15). The draft starts in the time zone of this browser.
 */
export function NewAssignment() {
  const classId = useParams<'classId'>().classId!; // the route has :classId
  const navigate = useNavigate();
  const create = useCreateAssignment(classId);
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState } = useForm({ resolver: zodResolver(BasicsSchema), mode: 'onBlur' });

  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    create.mutate(
      { ...values, timezone: browserTimeZone() },
      {
        onSuccess: (draft) => void navigate(`/assignments/${draft.id}/edit?step=2`, { state: { saved: true } }),
        onError: (error) => showApiError(error, setError, setFormError, ['title', 'instructions']),
      },
    );
  });

  return (
    <WizardFrame classId={classId} title="New assignment" step={1}>
      <form onSubmit={onSubmit} noValidate className="space-y-[18px]">
        {formError && <Alert>{formError}</Alert>}
        <BasicsFields register={register} errors={formState.errors} />
        <div className="pt-[18px]">
          <Button type="submit" loading={create.isPending}>
            Continue
          </Button>
        </div>
      </form>
    </WizardFrame>
  );
}
