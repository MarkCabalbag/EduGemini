import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary';

/** Class names for a button. Also used by links that look like buttons. */
export function buttonClass(variant: Variant = 'primary') {
  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 font-semibold disabled:opacity-60';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-primary-fg hover:bg-primary-hover'
      : 'border border-input-border bg-surface text-fg hover:bg-border';
  return `${base} ${styles}`;
}

type Props = ComponentProps<'button'> & { variant?: Variant; loading?: boolean };

/** The label stays visible while loading; a spinner is added (UX Brief §7). */
export function Button({ variant = 'primary', loading = false, children, className, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant)} ${className ?? ''}`}
    >
      {loading && <Loader2 aria-hidden size={20} className="animate-spin" />}
      {children}
    </button>
  );
}
