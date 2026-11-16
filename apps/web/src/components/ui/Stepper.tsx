import { Circle, CircleCheck, CircleDot } from 'lucide-react';

/**
 * Where the person is in a multi-step form (UX Brief §7). The words come first: "Step 2 of 5: Criteria". Wide screens also
 * list every step; phones get a progress bar instead.
 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progress" className="space-y-2">
      <p className="font-semibold">
        Step {current} of {steps.length}: {steps[current - 1]}
      </p>
      <ol className="hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
        {steps.map((name, index) => {
          const number = index + 1;
          const Icon = number < current ? CircleCheck : number === current ? CircleDot : Circle;
          return (
            <li
              key={name}
              aria-current={number === current ? 'step' : undefined}
              className={`inline-flex items-center gap-1 ${number === current ? 'font-semibold' : 'text-muted'}`}
            >
              <Icon aria-hidden size={16} />
              {name}
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="h-2 rounded-full bg-border sm:hidden">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${(current / steps.length) * 100}%` }} />
      </div>
    </nav>
  );
}
