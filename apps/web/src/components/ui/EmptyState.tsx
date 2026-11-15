import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** An icon, one sentence and one action. Text only, no illustration (UX Brief §10.8). */
export function EmptyState({ icon: Icon, action, children }: { icon: LucideIcon; action: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-border bg-surface p-6">
      <Icon aria-hidden size={32} className="text-muted" />
      <p>{children}</p>
      {action}
    </div>
  );
}
