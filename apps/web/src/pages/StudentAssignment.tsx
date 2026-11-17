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
import { useMySubmission } from '../hooks/use-submission';
import { ApiRequestError } from '../lib/api';
import { scoringText } from '../lib/assignment-meta';
import { errorText } from '../lib/error-text';
import { browserTimeZone, formatDue } from '../lib/zoned-time';
import { NotFound } from './NotFound';
import { SubmissionReceipt } from './SubmissionReceipt';
import { UploadFiles } from './UploadFiles';

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

/**
 * The student's part of the page: the upload control (with the files of an upload still open) until they have submitted, then the receipt. When the due date has
 * passed and late work is closed, a student who has not submitted sees that instead of the upload control. A submitted student
 * sees the receipt, with the result once it is ready (the page asks again every 5 seconds until then). The resubmit control
 * comes with its ticket.
 */
function SubmissionArea({ assignmentId, canUpload }: { assignmentId: string; canUpload: boolean }) {
  const mine = useMySubmission(assignmentId);
  if (mine.isPending) return <PageLoading />;
  if (mine.isError) return <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />;
  const { state, closed } = mine.data;
  if (state !== 'NOT_SUBMITTED' && state !== 'UPLOADING') return <SubmissionReceipt submission={mine.data} />;
  if (!canUpload) return null;
  // The upload control reads the open upload's files once, when it appears. An answer cached from an earlier visit may not
  // list files stored since, so it waits for the fresh one.
  if (!mine.isFetchedAfterMount) return <PageLoading />;
  if (closed) {
    return (
      <section className="space-y-2">
        <h2 className="text-title font-semibold">Your submission</h2>
        <StatusChip tone="info">Closed</StatusChip>
        <p>{errorText('LATE_CLOSED')}</p>
      </section>
    );
  }
  return <UploadFiles assignmentId={assignmentId} draft={mine.data.draftVersion} />;
}

/**
 * What an approved student reads about one published assignment (App Flow §6 step 3), and the control to upload their files.
 * An archived class is read-only, so it has no upload control (UX Brief, student pages).
 */
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
        <title>{`${assignment.title} · EduGemini`}</title>
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
      <SubmissionArea assignmentId={assignment.id} canUpload={cls.data?.status === 'ACTIVE'} />
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
