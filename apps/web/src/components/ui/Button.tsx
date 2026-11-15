import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const STYLES: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'border border-input-border bg-surface text-fg hover:bg-border',
  danger: 'bg-danger text-primary-fg hover:opacity-90', // for the button that confirms a destructive action (UX Brief §10.2)
};

/** Class names for a button. Also used by links that look like buttons. */
export function buttonClass(variant: Variant = 'primary') {
  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 font-semibold disabled:opacity-60';
  return `${base} ${STYLES[variant]}`;
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
