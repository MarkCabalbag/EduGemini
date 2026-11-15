import { AlertCircle, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** A page-level message with an icon and words (UX Brief §7). Errors are announced to screen readers. */
export function Alert({ variant = 'error', children }: { variant?: 'error' | 'info'; children: ReactNode }) {
  const Icon = variant === 'error' ? AlertCircle : Info;
  const colors = variant === 'error' ? 'bg-error-bg text-error-fg' : 'bg-info-bg text-info-fg';
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-md p-3 ${colors}`}>
      <Icon aria-hidden size={20} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
