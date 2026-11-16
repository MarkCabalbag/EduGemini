import { useId, type ComponentProps } from 'react';
import { FieldError } from './FieldError';

type Props = ComponentProps<'select'> & { label: string; error?: string; helper?: string };

/** A labelled drop-down, the browser's own so it works with a keyboard and a screen reader. Same rules as TextField (UX Brief §7, §12). */
export function SelectField({ label, error, helper, children, ...select }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <select
        {...select}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-11 w-full rounded-md border border-input-border bg-surface px-3 text-fg aria-invalid:border-2 aria-invalid:border-danger"
      >
        {children}
      </select>
      {helper && (
        <p id={`${id}-helper`} className="mt-1 text-small text-muted">
          {helper}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
