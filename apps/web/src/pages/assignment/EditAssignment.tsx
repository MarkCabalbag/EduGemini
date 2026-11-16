import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageLoading } from '../../components/ui/Skeleton';
import { useAssignment } from '../../hooks/use-assignments';
import { ApiRequestError } from '../../lib/api';
import { NotFound } from '../NotFound';
import { BasicsStep } from './BasicsStep';
import { CriteriaStep } from './CriteriaStep';
import { DueScoringStep } from './DueScoringStep';
import { PublishedEdit } from './PublishedEdit';
import { ReviewStep } from './ReviewStep';
import { RulesStep } from './RulesStep';
import { STEPS, WizardFrame } from './WizardFrame';

/** The step in `?step=`, from 1 to 5. Anything else is the first. */
const stepFrom = (value: string | null) => {
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= STEPS.length ? step : 1;
};

/** A draft, one step at a time (App Flow §5.1), each step saving the draft before it moves on; or a published assignment, on one page. */
export function EditAssignment() {
  const assignmentId = useParams<'assignmentId'>().assignmentId!; // the route has :assignmentId
  const step = stepFrom(useSearchParams()[0].get('step'));
  const navigate = useNavigate();
  const assignment = useAssignment(assignmentId);

  if (assignment.isPending) return <PageLoading />;
  if (assignment.isError) {
    // Someone else's assignment, a student, one that does not exist and an address that is not an id all look the same (API Spec A3).
    const notFound = assignment.error instanceof ApiRequestError && (assignment.error.code === 'NOT_FOUND' || assignment.error.code === 'VALIDATION');
    return notFound ? <NotFound /> : <ErrorState error={assignment.error} onRetry={() => void assignment.refetch()} />;
  }

  const { classId, status, title } = assignment.data;
  if (status === 'PUBLISHED') return <PublishedEdit assignment={assignment.data} />;
  if (status !== 'DRAFT') {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-display font-semibold">{title}</h1>
        <p>This assignment is archived and cannot be edited.</p>
        <Link to={`/classes/${classId}?tab=assignments`} className="font-semibold text-primary underline">
          Back to assignments
        </Link>
      </div>
    );
  }

  const goTo = (to: number, saved = false) => void navigate(`/assignments/${assignmentId}/edit?step=${to}`, { state: { saved } });
  const props = { assignment: assignment.data, onBack: () => goTo(step - 1), onSaved: () => goTo(step + 1, true) };

  return (
    <WizardFrame classId={classId} title={title} step={step}>
      {step === 1 && <BasicsStep {...props} onBack={undefined} />}
      {step === 2 && <CriteriaStep {...props} />}
      {step === 3 && <DueScoringStep {...props} />}
      {step === 4 && <RulesStep {...props} />}
      {step === 5 && <ReviewStep assignment={assignment.data} onBack={props.onBack} />}
    </WizardFrame>
  );
}
