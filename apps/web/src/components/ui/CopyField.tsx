import { useEffect, useId, useState } from 'react';
import { Button } from './Button';

const MESSAGE = {
  idle: '',
  copied: 'Copied',
  failed: 'Could not copy. Select the text and copy it yourself.',
} as const;

/** A read-only value with a Copy button. The result is announced through a live region (UX Brief §7). */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  // `press` counts the presses. It is the key of the message, so pressing Copy again replaces the message with a new
  // one, which is announced again, and the timer below starts over.
  const [result, setResult] = useState<{ kind: keyof typeof MESSAGE; press: number }>({ kind: 'idle', press: 0 });

  useEffect(() => {
    if (result.kind === 'idle') return;
    const timer = setTimeout(() => setResult((now) => ({ ...now, kind: 'idle' })), 2000);
    return () => clearTimeout(timer);
  }, [result]);

  async function copy() {
    let kind: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      kind = 'failed';
    }
    setResult((now) => ({ kind, press: now.press + 1 }));
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-input-border bg-surface px-3 font-mono text-fg"
        />
        <Button variant="secondary" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p role="status" className="mt-1 min-h-5 text-small text-muted">
        {result.kind !== 'idle' && <span key={result.press}>{MESSAGE[result.kind]}</span>}
      </p>
    </div>
  );
}
