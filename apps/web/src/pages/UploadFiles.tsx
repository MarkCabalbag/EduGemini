import { AlertCircle, Plus } from 'lucide-react';
import { useId } from 'react';
import { LIMITS, MiB, type DraftVersion } from '@edugemini/shared';
import { Button, buttonClass } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { useUpload, type UploadItem } from '../hooks/use-upload';
import { formatSize } from '../lib/upload-files';

/** What a file's row says, in words. The state is never shown by color or an icon alone (UX Brief §8, §10.3). */
function State({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  switch (item.state) {
    case 'ready':
      return <span>Ready</span>;
    case 'uploading':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="pending">Uploading…</StatusChip>
          {/* The words carry the state; the bar and the number only add to them, so a screen reader is not told every percent. */}
          <progress max={100} value={item.percent ?? 0} aria-hidden className="h-2 w-24" />
          <span aria-hidden>{item.percent ?? 0}%</span>
        </div>
      );
    case 'stored':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="approved">Uploaded</StatusChip>
          {item.message && (
            <span className="inline-flex items-center gap-1 text-error-fg">
              <AlertCircle aria-hidden size={16} />
              {item.message}
            </span>
          )}
        </div>
      );
    case 'removing':
      return <StatusChip tone="pending">Removing…</StatusChip>;
    case 'failed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-error-fg">
            <AlertCircle aria-hidden size={16} />
            Couldn&apos;t upload. {item.message}
          </span>
          <Button variant="secondary" onClick={onRetry} aria-label={`Retry ${item.name}`}>
            Retry
          </Button>
        </div>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 text-error-fg">
          <AlertCircle aria-hidden size={16} />
          {item.message}
        </span>
      );
  }
}

const files = (count: number) => (count === 1 ? '1 file' : `${count} files`);

/** Why Submit is disabled, or how many files it will send (UX Brief, Upload). */
function submitHelp({ stored, waiting, stuck }: { stored: number; waiting: number; stuck: number }): string {
  if (waiting > 0) return `Waiting for ${files(waiting)} to finish uploading`;
  if (stuck > 0) return `${files(stuck)} couldn't be uploaded. Retry or remove ${stuck === 1 ? 'it' : 'them'}.`;
  if (stored === 0) return 'Add a file to submit.';
  return `${files(stored)} ready to submit`;
}

/**
 * The student's upload control (App Flow §6 step 4, UX Brief Upload). Each file is checked when it is chosen, then sent on
 * its own, and Submit sends the stored ones as the submission. A student who comes back to an upload that is still open
 * sees the files already stored in it, and can remove them. Thumbnails and reordering come with the tickets for them.
 */
export function UploadFiles({ assignmentId, draft }: { assignmentId: string; draft: DraftVersion | null }) {
  const { items, addFiles, retry, remove, submit, submitting, submitError, counts } = useUpload(assignmentId, draft);
  const inputId = useId();
  const helpId = useId();
  const canSubmit = counts.stored > 0 && counts.waiting === 0 && counts.stuck === 0;

  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">Your files</h2>
      <p className="text-small text-muted">
        PDF, JPG or PNG. Up to {LIMITS.filesPerSubmission} files, {LIMITS.maxFileBytes / MiB} MB each, {LIMITS.maxSubmissionBytes / MiB} MB in
        total. PDFs up to {LIMITS.maxPdfPages} pages.
      </p>
      <input
        id={inputId}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        className="peer sr-only"
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])]; // copied first: clearing the input empties the list
          event.target.value = ''; // so choosing the same file again still counts
          void addFiles(chosen);
        }}
      />
      <label htmlFor={inputId} className={`${buttonClass('secondary')} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2`}>
        <Plus aria-hidden size={20} />
        Add photos or PDF
      </label>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{item.name}</p>
                <p className="text-small text-muted">{formatSize(item.size)}</p>
              </div>
              <div role="status" className="text-small">
                <State item={item} onRetry={() => retry(item.id)} />
              </div>
              {(item.state === 'rejected' || item.state === 'failed' || item.state === 'stored') && (
                <Button variant="secondary" onClick={() => void remove(item.id)} aria-label={`Remove ${item.name}`}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <p id={helpId} className="text-small text-muted">
          {submitHelp(counts)}
        </p>
        <Button onClick={() => void submit()} disabled={!canSubmit} loading={submitting} aria-describedby={helpId}>
          Submit files
        </Button>
        {submitError && (
          <p role="alert" className="inline-flex items-center gap-1 text-error-fg">
            <AlertCircle aria-hidden size={16} />
            {submitError}
          </p>
        )}
      </div>
    </section>
  );
}
