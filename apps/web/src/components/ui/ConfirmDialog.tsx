import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { Button } from './Button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  /** The request is running: the dialog cannot be closed, and the confirm button shows a spinner. */
  pending?: boolean;
};

/**
 * Asks before a destructive action (UX Brief §10.2). Focus is trapped and returns to the button that opened it, and
 * Escape closes it, except while the request runs. Cancel has the focus first, never the destructive button.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, pending = false }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Radix only returns focus to its own trigger. This dialog is opened from a button in a list, so it remembers that button.
  const opener = useRef<HTMLElement | null>(null);
  const stayWhilePending = (event: Event) => {
    if (pending) event.preventDefault();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/40" />
        {/* A sheet from the bottom on phones, centered and at most 560 px wide from tablets up (UX Brief §14). */}
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            opener.current = document.activeElement as HTMLElement | null; // the focus has not moved yet
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          onEscapeKeyDown={stayWhilePending}
          onInteractOutside={stayWhilePending}
          className="fixed inset-x-0 bottom-0 z-50 space-y-4 rounded-t-lg border border-border bg-surface p-6 shadow-overlay sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-140 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
        >
          <Dialog.Title className="text-title font-semibold">{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={cancel} variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
