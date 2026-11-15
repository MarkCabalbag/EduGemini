import { useId, type ComponentProps } from 'react';
import { FieldError } from './FieldError';

type Props = Omit<ComponentProps<'input'>, 'type' | 'value'> & {
  legend: string;
  options: { value: string; label: string }[];
  error?: string;
};

/** Radio buttons in a fieldset. Spread a react-hook-form `register(...)` result onto it. */
export function RadioGroup({ legend, options, error, ...input }: Props) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1 font-semibold">{legend}</legend>
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-11 items-center gap-3">
            <input {...input} type="radio" value={option.value} className="size-5 accent-primary" />
            {option.label}
          </label>
        ))}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </fieldset>
  );
}
