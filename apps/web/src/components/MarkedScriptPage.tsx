import type { ReactNode } from 'react';
import { usePaperPage } from '../hooks/use-paper-page';

/**
 * A score circled in the teacher's red pen, with a tick: the product's promise drawn, not said. Pure decoration; the
 * sentences beside it say the same thing in words. The circle and tick draw themselves once (index.css, .pen-stroke).
 * Six rows of the sheet tall on wide screens, three on phones, so the writing after it stays on the lines.
 */
function TeacherMark() {
  return (
    <svg viewBox="0 0 340 232" className="h-[108px] w-auto sm:h-[216px]" aria-hidden="true" focusable="false">
      <text
        x="166"
        y="138"
        textAnchor="middle"
        transform="rotate(-5 166 104)"
        className="font-hand"
        fontSize="112"
        fill="var(--margin-red)"
      >
        42/50
      </text>
      <g fill="none" stroke="var(--margin-red)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path
          className="pen-stroke"
          pathLength={1}
          d="M40 34 C120 6 286 14 314 86 C330 150 236 188 150 184 C60 180 4 150 6 100 C8 60 36 38 84 24"
        />
        <path className="pen-stroke later" pathLength={1} d="M252 202 L270 222 L322 160" />
      </g>
    </svg>
  );
}

/**
 * The Marked Script page frame for the sign-in and sign-up forms: the whole page, header included, becomes the ruled sheet
 * while it is open (index.css, .paper-page), the form is written in the column right of the margin, and the teacher's mark
 * with one plain statement of the product sits beside it.
 */
export function MarkedScriptPage({ children }: { children: ReactNode }) {
  usePaperPage();

  return (
    <div className="grid gap-x-20 gap-y-[72px] pl-6 leading-9 sm:pl-12 lg:grid-cols-[minmax(0,32.5rem)_1fr]">
      <div>{children}</div>
      <aside aria-label="About EduGemini" className="max-w-md">
        <TeacherMark />
        <p className="font-hand text-[2rem] leading-9 text-[var(--margin-red)]">AI marks it first. The teacher has the final say.</p>
        <p className="text-primary">
          EduGemini gives a first-pass score and feedback against the instructor&apos;s own criteria. Every grade waits for the
          instructor&apos;s approval.
        </p>
      </aside>
    </div>
  );
}
