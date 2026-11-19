import { useState } from 'react';
import type { StudentSubmission } from '@edugemini/shared';
import { Button } from '../components/ui/Button';
import { errorText } from '../lib/error-text';
import { UploadFiles } from './UploadFiles';

/**
 * What a student who has already submitted can do next (App Flow §6 step 7, PRD FR-SUB-05, FR-SUB-09). Closed late work and
 * no attempts left each replace the control with the reason; otherwise a Resubmit button opens the upload control, and so does an
 * upload that is still open from an earlier visit. Locked after approval (SUB-08) comes with its ticket.
 */
export function Resubmit({ assignmentId, submission }: { assignmentId: string; submission: StudentSubmission }) {
  const [started, setStarted] = useState(false);
  const { attemptsLeft, closed, draftVersion } = submission;

  if (closed) return <p>{errorText('LATE_CLOSED')}</p>;
  if (attemptsLeft === 0) return <p>{errorText('ATTEMPTS_EXHAUSTED')}</p>;
  if (draftVersion || started) return <UploadFiles assignmentId={assignmentId} draft={draftVersion} onClose={() => setStarted(false)} />;
  return (
    <Button variant="secondary" onClick={() => setStarted(true)}>
      {attemptsLeft === null ? 'Resubmit' : `Resubmit (${attemptsLeft} left)`}
    </Button>
  );
}
