import { Check } from 'lucide-react';

/**
 * Where the person is in a multi-step form (UX Brief §7), written on the sheet: the words come first, "Step 2 of 5:
 * Criteria", then every step. Wide screens list them down the side with a red tick for each finished step, the current
 * number circled by hand and the rest in pencil; phones get a row of numbers (the names stay for screen readers).
 */
export function Stepper({ steps, current, className = '' }: { steps: string[]; current: number; className?: string }) {
  return (
    <nav aria-label="Progress" className={className}>
      <p className="leading-9 font-bold">
        Step {current} of {steps.length}: {steps[current - 1]}
      </p>
      <ol className="flex gap-3.5 lg:block">
        {steps.map((name, index) => {
          const number = index + 1;
          const state = number < current ? 'done' : number === current ? 'current' : 'todo';
          return (
            <li key={name} aria-current={number === current ? 'step' : undefined} className={`step is-${state}`}>
              <span aria-hidden className="step-n">
                {state === 'done' ? <Check size={20} strokeWidth={3} /> : number}
              </span>
              <span className="sr-only lg:not-sr-only">{name}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
