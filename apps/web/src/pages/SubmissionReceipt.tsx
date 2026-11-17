import type { DisplayState, StudentSubmission } from '@edugemini/shared';
import { StatusChip } from '../components/ui/StatusChip';
import { gradeScoreText } from '../lib/assignment-meta';
import { formatSize } from '../lib/upload-files';
import { browserTimeZone, formatDue } from '../lib/zoned-time';

// The student's words for each state (API Spec A5).
const STATE_TEXT: Record<DisplayState, string> = {
  NOT_SUBMITTED: 'Not submitted',
  UPLOADING: 'Uploading',
  GRADING: 'Grading in progress, usually about a minute',
  AWAITING_REVIEW: 'Submitted, awaiting instructor review',
  AI_GENERATED: 'AI-generated',
  INSTRUCTOR_APPROVED: 'Instructor-approved',
};

/**
 * What the student submitted and when, shown right after Submit and every time they come back (App Flow §6 step 5, PRD FR-SUB-08),
 * and the result once grading is done: the score in the assignment's format and the feedback (App Flow §6 step 6, PRD FR-AI-03).
 */
export function SubmissionReceipt({ submission }: { submission: StudentSubmission }) {
  const { state, latestSubmittedAt, files, isLate, grade, instructorComment } = submission;
  const tone = state === 'AI_GENERATED' ? 'ai' : state === 'INSTRUCTOR_APPROVED' ? 'approved' : 'pending';
  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">Your submission</h2>
      {/* A live region, so a screen reader hears the state change from Grading to the result (UX Brief §12). */}
      <div role="status" className="flex flex-wrap items-center gap-2">
        <StatusChip tone={tone}>{STATE_TEXT[state]}</StatusChip>
        {isLate && <StatusChip tone="info">Late</StatusChip>}
      </div>
      {grade && (
        <div className="space-y-3 rounded-md border border-border bg-surface p-4">
          <div>
            <h3 className="text-small font-semibold text-muted">Score</h3>
            <p className="text-display font-semibold">{gradeScoreText(grade)}</p>
          </div>
          <div>
            <h3 className="text-small font-semibold text-muted">Feedback</h3>
            <p className="whitespace-pre-line">{grade.feedback}</p>
          </div>
          {instructorComment && (
            <div>
              <h3 className="text-small font-semibold text-muted">Instructor comment</h3>
              <p className="whitespace-pre-line">{instructorComment}</p>
            </div>
          )}
        </div>
      )}
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
