import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { AssignmentDetail } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useAssignment, useOpenReferenceFile } from '../hooks/use-assignments';
import { useClass } from '../hooks/use-classes';
import { useMySubmission } from '../hooks/use-submission';
import { ApiRequestError } from '../lib/api';
import { attemptsLeftText, scoringText } from '../lib/assignment-meta';
import { errorText, errorTextOf } from '../lib/error-text';
import { browserTimeZone, formatDue } from '../lib/zoned-time';
import { NotFound } from './NotFound';
import { Resubmit } from './Resubmit';
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

/** The reference files the instructor marked visible (the API sends a student only those). Each opens in a new tab through a link that lasts five minutes (API Spec REF-04). */
function ReferenceFileList({ files }: { files: AssignmentDetail['referenceFiles'] }) {
  const open = useOpenReferenceFile();
  return (
    <section className="space-y-2">
      <h2 className="text-title font-semibold">Reference files</h2>
      <ul className="space-y-1">
        {files.map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-3">
            <span>{file.label}</span>
            <Button
              type="button"
              variant="secondary"
              loading={open.isPending && open.variables === file.id}
              onClick={() => open.mutate(file.id)}
            >
              Open <span className="sr-only">{file.label}</span>
            </Button>
          </li>
        ))}
      </ul>
      {open.isError && <Alert>{errorTextOf(open.error)}</Alert>}
    </section>
  );
}

/**
 * The student's part of the page: the upload control (with the files of an upload still open) until they have submitted, then the receipt. When the due date has
 * passed and late work is closed, a student who has not submitted sees that instead of the upload control. A submitted student
 * sees the receipt, with the result once it is ready (the page asks again every 5 seconds until then), and below it the
 * Resubmit control (`Resubmit.tsx`).
 */
function SubmissionArea({ assignmentId, canUpload }: { assignmentId: string; canUpload: boolean }) {
  const mine = useMySubmission(assignmentId);
  if (mine.isPending) return <PageLoading />;
  if (mine.isError) return <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />;
  const { state, closed } = mine.data;
  if (state !== 'NOT_SUBMITTED' && state !== 'UPLOADING') {
    // An approved submission is read-only (App Flow §6 step 9); the message and the reopening come with SUB-08 and REV-06.
    const canResubmit = canUpload && state !== 'INSTRUCTOR_APPROVED';
    return (
      <div className="space-y-6">
        <SubmissionReceipt submission={mine.data} />
        {canResubmit && <Resubmit assignmentId={assignmentId} submission={mine.data} />}
      </div>
    );
  }
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
  // The same answer the submission area reads, so the count is on top of the page without a second request.
  const mine = useMySubmission(assignment.id);

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
        {/* An archived class takes no submissions and an approved one is read-only, so there is nothing to count (UX Brief, AttemptsCounter). */}
        {mine.data && cls.data?.status === 'ACTIVE' && mine.data.state !== 'INSTRUCTOR_APPROVED' && (
          <p className="text-muted">{attemptsLeftText(mine.data.attemptsLeft)}</p>
        )}
      </div>
      {assignment.instructions && <Section title="Instructions">{assignment.instructions}</Section>}
      <Section title="Criteria">{assignment.criteriaText}</Section>
      {assignment.referenceFiles.length > 0 && <ReferenceFileList files={assignment.referenceFiles} />}
      <SubmissionArea assignmentId={assignment.id} canUpload={cls.data?.status === 'ACTIVE'} />
      <p className="text-small text-muted">{DISCLOSURE}</p>
    </div>
  );
}

/** The assignment page for a student. A draft, an archived assignment, a pending, declined or removed student and a stranger all see the same "not found" (API Spec A3, API-7). */
export function StudentAssignment() {
  const assignmentId = useParams<'assignmentId'>().assignmentId!; // the route has :assignmentId
  const assignment = useAssignment(assignmentId);

  if (assignment.isPending) return <PageLoading />;
  if (assignment.isError) {
    const error = assignment.error;
    const hidden = error instanceof ApiRequestError && ['NOT_FOUND', 'VALIDATION', 'ENROLLMENT_PENDING'].includes(error.code);
    return hidden ? <NotFound /> : <ErrorState error={error} onRetry={() => void assignment.refetch()} />;
  }
  return <AssignmentPage assignment={assignment.data} />;
}
