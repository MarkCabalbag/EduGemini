import { useId, type ComponentProps, type ReactNode } from 'react';
import { FieldError } from './FieldError';

type Props = Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode; error?: string; helper?: string };

export function Checkbox({ label, error, helper, ...input }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      {/* The whole row is the label, so it toggles the box and is at least 44 px tall, like RadioGroup (UX Brief §12). */}
      <label htmlFor={id} className="flex min-h-11 items-start gap-3 py-2.5">
        <input
          {...input}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>{label}</span>
      </label>
      {helper && (
        <p id={`${id}-helper`} className="text-small text-muted">
          {helper}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
