import { useEffect, useId, useState } from 'react';
import { Button } from './Button';

const MESSAGE = {
  idle: '',
  copied: 'Copied',
  failed: 'Could not copy. Select the text and copy it yourself.',
} as const;

/**
 * A read-only value with a Copy button. The result is announced through a live region (UX Brief §7). `boxes` writes the
 * value one character per box, like a candidate number on an exam paper (a class code); `hideLabel` keeps the label for
 * screen readers only, under a heading that already says it.
 */
export function CopyField({
  label,
  value,
  boxes = false,
  hideLabel = false,
}: {
  label: string;
  value: string;
  boxes?: boolean;
  hideLabel?: boolean;
}) {
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
    <div className="copy-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block font-semibold'}>
        {label}
      </label>
      <div className="copy-row flex gap-2">
        <span className="min-w-0 flex-1">
          {/* The boxes are what is seen (and can be selected by hand); the labelled input still carries the value for
              screen readers, out of the tab order since the boxes cannot show its focus. */}
          {boxes && (
            <span aria-hidden className="code-boxes" style={{ gridTemplateColumns: `repeat(${value.length}, minmax(0, 1fr))` }}>
              {[...value].map((char, index) => (
                <span key={index}>{char}</span>
              ))}
            </span>
          )}
          <input
            id={id}
            readOnly
            value={value}
            tabIndex={boxes ? -1 : undefined}
            onFocus={(event) => event.currentTarget.select()}
            className={boxes ? 'sr-only' : 'min-h-11 w-full rounded-md border border-input-border bg-surface px-3 font-mono text-fg'}
          />
        </span>
        <Button variant="secondary" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p role="status" className="copy-status mt-1 min-h-5 text-small text-muted">
        {result.kind !== 'idle' && <span key={result.press}>{MESSAGE[result.kind]}</span>}
      </p>
    </div>
  );
}
