import { useId, type ComponentProps } from 'react';
import { FieldError } from './FieldError';

type Props = ComponentProps<'input'> & { label: string; error?: string; helper?: string };

/** A labelled input. The label is always visible; the error is tied to the field for screen readers (UX Brief §7, §12). */
export function TextField({ label, error, helper, ...input }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-11 w-full rounded-md border border-input-border bg-surface px-3 text-fg aria-invalid:border-2 aria-invalid:border-danger"
      />
      {helper && (
        <p id={`${id}-helper`} className="mt-1 text-small text-muted">
          {helper}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
