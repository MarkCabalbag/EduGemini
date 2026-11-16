import type { FormEventHandler, ReactNode } from 'react';
import type { AssignmentDetail } from '@edugemini/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

/**
 * What every step of the wizard is given: the assignment, and where to go once a save works or when Back is pressed. A
 * step on the edit page of a published assignment has no Back and says "Save changes" instead of "Continue".
 */
export type StepProps = { assignment: AssignmentDetail; onSaved: () => void; onBack?: () => void; submitLabel?: string };

type Props = {
  onSubmit: FormEventHandler<HTMLFormElement>;
  saving: boolean;
  formError?: string;
  onBack?: () => void;
  submitLabel?: string;
  children: ReactNode;
};

/** The frame of one wizard step: the problem with the whole form, the step's fields, Back and Continue. */
export function StepForm({ onSubmit, saving, formError, onBack, submitLabel = 'Continue', children }: Props) {
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      {children}
      <div className="flex flex-wrap items-center gap-4">
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        )}
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
