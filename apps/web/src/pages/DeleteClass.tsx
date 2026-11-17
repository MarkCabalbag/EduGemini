import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TextField } from '../components/ui/TextField';
import { useArchiveClass, useDeleteClass, useDeletionImpact } from '../hooks/use-classes';
import { errorTextOf } from '../lib/error-text';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Mounted only while the dialog is open, so the counts are asked for then and read fresh each time (API Spec CLS-11). */
function DeleteDialog({ cls, onClose }: { cls: ClassSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const impact = useDeletionImpact(cls.id);
  const remove = useDeleteClass(cls.id);
  const archive = useArchiveClass(cls.id);
  const [typed, setTyped] = useState('');
  const failure = remove.error ?? archive.error ?? impact.error;

  return (
    <ConfirmDialog
      open
      onOpenChange={onClose}
      title={`Delete ${cls.name}?`}
      description="This permanently deletes the class and everything in it. It can't be undone."
      confirmLabel="Delete class"
      pending={remove.isPending}
      // The name is the instructor's own words, so the check is repeated by the API, which has the stored name.
      confirmDisabled={!impact.data || typed.trim() !== cls.name || archive.isPending}
      onConfirm={() => remove.mutate(typed, { onSuccess: () => navigate('/classes') })}
    >
      {impact.data && (
        <p>
          This deletes {count(impact.data.students, 'student', 'students')}, {count(impact.data.assignments, 'assignment', 'assignments')} and{' '}
          {count(impact.data.submissions, 'submission', 'submissions')}, with all their files.
        </p>
      )}
      {impact.isPending && <p className="text-muted">Counting what will be deleted…</p>}
      {cls.status === 'ACTIVE' && (
        <div className="space-y-2">
          <p>Want to keep it? Archiving makes the class read-only and keeps everything.</p>
          <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate(true, { onSuccess: onClose })}>
            Archive instead
          </Button>
        </div>
      )}
      <TextField
        label={`Type ${cls.name} to confirm`}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {failure && <Alert>{errorTextOf(failure)}</Alert>}
    </ConfirmDialog>
  );
}

/** Delete class, in the Danger zone card of Overview (API Spec CLS-07, CLS-11). Asks first, and the name has to be typed. */
export function DeleteClass({ cls }: { cls: ClassSummary }) {
  const [asking, setAsking] = useState(false);

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p>Deleting removes the class, its students' work and all its files for good.</p>
      <Button variant="secondary" onClick={() => setAsking(true)}>
        Delete class
      </Button>
      {asking && <DeleteDialog cls={cls} onClose={() => setAsking(false)} />}
    </div>
  );
}
