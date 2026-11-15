import { useId, type ComponentProps } from 'react';
import { FieldError } from './FieldError';

type Props = ComponentProps<'textarea'> & { label: string; error?: string; helper?: string };

/** A labelled multi-line input. Same rules as TextField (UX Brief §7, §12). */
export function TextAreaField({ label, error, helper, ...textarea }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <textarea
        rows={3}
        {...textarea}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="w-full rounded-md border border-input-border bg-surface px-3 py-2 text-fg aria-invalid:border-2 aria-invalid:border-danger"
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
