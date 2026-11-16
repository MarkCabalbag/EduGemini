import { AlertCircle, Plus } from 'lucide-react';
import { useId } from 'react';
import { LIMITS, MiB } from '@edugemini/shared';
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
      return <StatusChip tone="pending">Uploading…</StatusChip>;
    case 'stored':
      return <StatusChip tone="approved">Uploaded</StatusChip>;
    case 'failed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-error-fg">
            <AlertCircle aria-hidden size={16} />
            Couldn&apos;t upload. {item.message}
          </span>
          <Button variant="secondary" onClick={onRetry} aria-label={`Retry ${item.file.name}`}>
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

/**
 * The student's upload control (App Flow §6 step 4, UX Brief Upload). Each file is checked when it is chosen, then sent on
 * its own. Thumbnails, reordering, progress in percent and Submit come with the tickets for them.
 */
export function UploadFiles({ assignmentId }: { assignmentId: string }) {
  const { items, addFiles, retry, remove } = useUpload(assignmentId);
  const inputId = useId();

  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">Your files</h2>
      <p className="text-small text-muted">
        PDF, JPG or PNG. Up to {LIMITS.filesPerSubmission} files, {LIMITS.maxFileBytes / MiB} MB each.
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
                <p className="truncate font-semibold">{item.file.name}</p>
                <p className="text-small text-muted">{formatSize(item.file.size)}</p>
              </div>
              <div role="status" className="text-small">
                <State item={item} onRetry={() => retry(item.id)} />
              </div>
              {item.state === 'rejected' && (
                <Button variant="secondary" onClick={() => remove(item.id)} aria-label={`Remove ${item.file.name}`}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
