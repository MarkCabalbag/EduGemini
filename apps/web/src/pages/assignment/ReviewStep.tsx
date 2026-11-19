import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClass } from '../../components/ui/Button';
import { usePublishAssignment } from '../../hooks/use-assignments';
import { ApiRequestError } from '../../lib/api';
import { resubmissionText, scoringText } from '../../lib/assignment-meta';
import { errorText } from '../../lib/error-text';
import { formatDue } from '../../lib/zoned-time';
import type { StepProps } from './StepForm';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[12.5rem_minmax(0,1fr)]">
      <dt className="font-bold text-primary">{label}</dt>
      <dd className="whitespace-pre-line">{children}</dd>
    </div>
  );
}

/** A refused publish says why: the problem with the field if there is one (empty criteria), else the usual text for the code. */
function failureText(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return errorText('INTERNAL');
  return (error.code === 'VALIDATION' ? Object.values(error.fields ?? {})[0] : undefined) ?? errorText(error.code);
}

/**
 * Step 5: everything on one screen, then Publish (App Flow §5.1). The draft is saved already, so "Save as draft" only
 * leaves. Publishing goes back to the list, which says it worked and shows the warnings the API gave.
 */
export function ReviewStep({ assignment, onBack }: Pick<StepProps, 'assignment' | 'onBack'>) {
  const navigate = useNavigate();
  const publish = usePublishAssignment(assignment.id);
  const [error, setError] = useState<string>();
  const list = `/classes/${assignment.classId}?tab=assignments`;

  const onPublish = () => {
    setError(undefined);
    publish.mutate(undefined, {
      onSuccess: ({ title, warnings }) => void navigate(list, { state: { published: { title, warnings } } }),
      onError: (failure) => setError(failureText(failure)),
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-[18px]">
          <Alert>{error}</Alert>
        </div>
      )}
      {/* Label and value written on the lines, no box. */}
      <dl>
        <Row label="Title">{assignment.title}</Row>
        <Row label="Instructions">{assignment.instructions ?? 'None'}</Row>
        <Row label="Grading criteria">{assignment.criteriaText || 'Not added yet. Add grading criteria before publishing.'}</Row>
        <Row label="Due">{formatDue(assignment.dueAt, assignment.timezone)}</Row>
        <Row label="Scoring">{scoringText(assignment)}</Row>
        <Row label="Resubmissions">{resubmissionText(assignment)}</Row>
        <Row label="Late submissions">{assignment.acceptLate ? 'Accepted, marked Late' : 'Not accepted'}</Row>
      </dl>
      <p className="text-[0.875rem] leading-9 text-muted">Your draft is saved. Publishing makes it visible to approved students.</p>
      <div className="flex flex-wrap items-stretch gap-x-3 gap-y-[18px] pt-[18px]">
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        )}
        <Link to={list} className={buttonClass('secondary')}>
          Save as draft
        </Link>
        <Button type="button" loading={publish.isPending} onClick={onPublish}>
          Publish assignment
        </Button>
      </div>
    </div>
  );
}
