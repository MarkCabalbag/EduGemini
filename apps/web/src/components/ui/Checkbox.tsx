import { useId, type ComponentProps, type ReactNode } from 'react';
import { FieldError } from './FieldError';

type Props = Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode; error?: string; helper?: string };

export function Checkbox({ label, error, helper, ...input }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, helper ? `${id}-helper` : null].filter(Boolean).join(' ');
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          {...input}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <label htmlFor={id}>{label}</label>
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
