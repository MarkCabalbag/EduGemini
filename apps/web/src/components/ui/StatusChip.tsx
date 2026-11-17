import { CircleCheck, Info, Loader } from 'lucide-react';

const TONES = {
  approved: { icon: CircleCheck, colors: 'bg-approved-bg text-approved-fg' },
  pending: { icon: Loader, colors: 'bg-pending-bg text-pending-fg' },
  info: { icon: Info, colors: 'bg-info-bg text-info-fg' },
};

/** A status in words, with an icon beside it. The words are the accessible name, so color is never the only signal (UX Brief §8). */
export function StatusChip({ tone, children }: { tone: keyof typeof TONES; children: string }) {
  const { icon: Icon, colors } = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-micro font-medium ${colors}`}>
      <Icon aria-hidden size={16} />
      {children}
    </span>
  );
}
