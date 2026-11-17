import { Plus } from 'lucide-react';
import { useId } from 'react';
import { LIMITS, type AssignmentDetail } from '@edugemini/shared';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClass } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { useAddReferenceFile, useOpenReferenceFile, useRemoveReferenceFile, useSetReferenceVisibility } from '../../hooks/use-assignments';
import { errorTextOf } from '../../lib/error-text';
import { formatSize } from '../../lib/upload-files';

/**
 * The reference files of an assignment (API Spec REF-01 to REF-04, UX Brief step 2): up to three, each with "Visible to
 * students" (off by default) and Remove. Gemini always sees them; a student only the ones marked visible. They are part of the
 * criteria, so adding or removing one needs the re-grade confirmation once the assignment is published (ASG-04). Until that
 * exists, `canChange` is false for a published assignment: the files are listed and can be shown or hidden.
 */
export function ReferenceFiles({ assignment, canChange }: { assignment: AssignmentDetail; canChange: boolean }) {
  const inputId = useId();
  const add = useAddReferenceFile(assignment.id);
  const toggle = useSetReferenceVisibility(assignment.id);
  const remove = useRemoveReferenceFile(assignment.id);
  const open = useOpenReferenceFile();
  const files = assignment.referenceFiles;
  const full = files.length >= LIMITS.maxReferenceFiles;
  const failure = add.error ?? toggle.error ?? remove.error ?? open.error;

  return (
    <section aria-labelledby={`${inputId}-heading`} className="space-y-3">
      <h2 id={`${inputId}-heading`} className="font-semibold">
        Reference files (optional, up to {LIMITS.maxReferenceFiles})
      </h2>
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="flex-1">
                {file.label} <span className="text-muted">({formatSize(file.sizeBytes)})</span>
              </span>
              <Button type="button" variant="secondary" loading={open.isPending && open.variables === file.id} onClick={() => open.mutate(file.id)}>
                Open{' '}
                <span className="sr-only">{file.label}</span>
              </Button>
              <Checkbox
                label={
                  <>
                    Visible to students<span className="sr-only">, {file.label}</span>
                  </>
                }
                checked={file.visibleToStudents}
                onChange={(event) => toggle.mutate({ fileId: file.id, visibleToStudents: event.target.checked })}
              />
              {canChange && (
                <Button type="button" variant="secondary" loading={remove.isPending && remove.variables === file.id} onClick={() => remove.mutate(file.id)}>
                  Remove{' '}
                  <span className="sr-only">{file.label}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canChange && (
        <>
          <input
            id={inputId}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="peer sr-only"
            disabled={full || add.isPending}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = ''; // so choosing the same file again still counts
              if (chosen) add.mutate(chosen);
            }}
          />
          <label
            htmlFor={inputId}
            aria-disabled={full || add.isPending}
            className={`${buttonClass('secondary')} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-60`}
          >
            <Plus aria-hidden size={20} />
            Add a reference file
          </label>
        </>
      )}
      {add.isPending && <p role="status">Adding the file…</p>}
      <p className="text-small text-muted">
        Gemini always sees these files. Students see only files marked visible. PDF, JPG or PNG, up to {LIMITS.maxFileBytes / (1024 * 1024)} MB each.
      </p>
      {failure && <Alert>{errorTextOf(failure)}</Alert>}
    </section>
  );
}
