import { useId, useState, type ComponentProps } from 'react';
import { FieldError } from './FieldError';

type Props = ComponentProps<'input'> & { label: string; error?: string; helper?: string; revealable?: boolean };

/**
 * A labelled input. The label is always visible; the error is tied to the field for screen readers (UX Brief §7, §12).
 * A `revealable` password field has a Show / Hide button that swaps the type, so people can check what they typed.
 */
export function TextField({ label, error, helper, revealable, ...input }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <div className="relative field-wrap">
        <input
          {...input}
          type={revealable && shown ? 'text' : input.type}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`min-h-11 w-full rounded-md border border-input-border bg-surface px-3 text-fg aria-invalid:border-2 aria-invalid:border-danger ${revealable ? 'pr-20' : ''}`}
        />
        {revealable && (
          <button
            type="button"
            className="field-reveal"
            aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            onClick={() => setShown((value) => !value)}
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {helper && (
        <p id={`${id}-helper`} className="mt-1 text-small text-muted">
          {helper}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
