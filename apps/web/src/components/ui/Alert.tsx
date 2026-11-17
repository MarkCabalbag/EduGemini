import { AlertCircle, Info } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * A page-level message with an icon and words (UX Brief §7), announced to screen readers. An error is an alert, which is
 * read as it appears. An info message is a status, which screen readers read only when its words change after it is on
 * the page, so its words go in just after the box appears.
 */
export function Alert({ variant = 'error', children }: { variant?: 'error' | 'info'; children: ReactNode }) {
  const [shown, setShown] = useState(variant === 'error');
  useEffect(() => setShown(true), []);
  const Icon = variant === 'error' ? AlertCircle : Info;
  const colors = variant === 'error' ? 'bg-error-bg text-error-fg' : 'bg-info-bg text-info-fg';
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-md p-3 ${colors}`}>
      <Icon aria-hidden size={20} className="mt-0.5 shrink-0" />
      <div>{shown && children}</div>
    </div>
  );
}
