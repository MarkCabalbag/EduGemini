import type { DisplayState, StudentSubmission } from '@edugemini/shared';
import { StatusChip } from '../components/ui/StatusChip';
import { formatSize } from '../lib/upload-files';
import { browserTimeZone, formatDue } from '../lib/zoned-time';

// The student's words for each state (API Spec A5). The result itself (score and feedback) comes with the grading tickets.
const STATE_TEXT: Record<DisplayState, string> = {
  NOT_SUBMITTED: 'Not submitted',
  UPLOADING: 'Uploading',
  GRADING: 'Grading in progress, usually about a minute',
  AWAITING_REVIEW: 'Submitted, awaiting instructor review',
  AI_GENERATED: 'AI-generated',
  INSTRUCTOR_APPROVED: 'Instructor-approved',
};

/** What the student submitted and when, shown right after Submit and every time they come back (App Flow §6 step 5, PRD FR-SUB-08). */
export function SubmissionReceipt({ submission }: { submission: StudentSubmission }) {
  const { latestSubmittedAt, files, isLate } = submission;
  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">Your submission</h2>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={submission.state === 'INSTRUCTOR_APPROVED' ? 'approved' : 'pending'}>{STATE_TEXT[submission.state]}</StatusChip>
        {isLate && <StatusChip tone="info">Late</StatusChip>}
      </div>
      {latestSubmittedAt && <p className="text-muted">Submitted {formatDue(latestSubmittedAt, browserTimeZone())}</p>}
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id} className="rounded-md border border-border bg-surface p-3">
            <p className="truncate font-semibold">{file.displayName}</p>
            {file.sizeBytes !== null && <p className="text-small text-muted">{formatSize(file.sizeBytes)}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
