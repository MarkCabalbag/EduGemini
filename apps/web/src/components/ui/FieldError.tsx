import { AlertCircle } from 'lucide-react';

/** Error text under a field: an icon and words, never color alone (UX Brief §10.1). An alert, so it is read out when it appears (UX Brief §12). */
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-start gap-1 text-small text-error-fg">
      <AlertCircle aria-hidden size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
