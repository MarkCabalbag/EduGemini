import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { AssignmentDetail } from '@edugemini/shared';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useAssignment } from '../hooks/use-assignments';
import { useMe } from '../hooks/use-auth';
import { useClass } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { scoringText } from '../lib/assignment-meta';
import { browserTimeZone, formatDue } from '../lib/zoned-time';
import { NotFound } from './NotFound';

// The exact wording of UX Brief §11.3 (PRD FR-AI-07). Every page that shows a score or will show one carries it, never behind a tooltip.
const DISCLOSURE = 'Scores and feedback are AI-generated and reviewed by your instructor. Questions about grades go to your instructor.';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-title font-semibold">{title}</h2>
      <p className="whitespace-pre-line">{children}</p>
    </section>
  );
}

/** What an approved student reads about one published assignment (App Flow §6 step 3). The upload comes with the submission tickets. */
function AssignmentPage({ assignment }: { assignment: AssignmentDetail }) {
  // The class gives the name for the way back, and says whether it is archived (read-only). The page works without it.
  const cls = useClass(assignment.classId);

  return (
    <div className="max-w-2xl space-y-6">
      <Link to={`/classes/${assignment.classId}`} className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        {cls.data?.name ?? 'Class'}
      </Link>
      <div className="space-y-2">
        <h1 className="text-display font-semibold">{assignment.title}</h1>
        {cls.data?.status === 'ARCHIVED' && <StatusChip tone="info">Archived</StatusChip>}
        <p className="text-muted">Due {formatDue(assignment.dueAt, browserTimeZone())}</p>
        <p className="text-muted">Scoring: {scoringText(assignment)}</p>
        <p className="text-muted">
          {assignment.acceptLate ? 'Late submissions are accepted and marked Late.' : 'Late submissions are not accepted.'}
        </p>
      </div>
      {assignment.instructions && <Section title="Instructions">{assignment.instructions}</Section>}
      <Section title="Criteria">{assignment.criteriaText}</Section>
      <p className="text-small text-muted">{DISCLOSURE}</p>
    </div>
  );
}

/** The assignment page for a student. A draft, an archived assignment, a pending, declined or removed student and a stranger all see the same "not found" (API Spec A3, API-7). */
export function StudentAssignment() {
  const assignmentId = useParams<'assignmentId'>().assignmentId!; // the route has :assignmentId
  const me = useMe().data;
  const assignment = useAssignment(assignmentId);

  // The API refuses everyone else too; this just keeps an instructor from getting a student's page (API Spec A3).
  if (me?.role !== 'STUDENT') return <NotFound />;
  if (assignment.isPending) return <PageLoading />;
  if (assignment.isError) {
    const error = assignment.error;
    const hidden = error instanceof ApiRequestError && ['NOT_FOUND', 'VALIDATION', 'ENROLLMENT_PENDING'].includes(error.code);
    return hidden ? <NotFound /> : <ErrorState error={error} onRetry={() => void assignment.refetch()} />;
  }
  return <AssignmentPage assignment={assignment.data} />;
}
