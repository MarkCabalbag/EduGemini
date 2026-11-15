import { AlertCircle } from 'lucide-react';

/** Error text under a field: an icon and words, never color alone (UX Brief §10.1). */
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-small text-error-fg">
      <AlertCircle aria-hidden size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
