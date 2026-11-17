import { ArrowLeft, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Stepper } from '../../components/ui/Stepper';

export const STEPS = ['Basics', 'Criteria', 'Due date and scoring', 'Rules', 'Review'];

/** What every step sits in: the way back to the class, the title, "Draft saved" after a save, and the stepper (UX Brief, wizard). */
export function WizardFrame({ classId, title, step, children }: { classId: string; title: string; step: number; children: ReactNode }) {
  // A step that has just been saved hands this on when it moves to the next one.
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;
  return (
    <div className="max-w-2xl space-y-6">
      <Link to={`/classes/${classId}?tab=assignments`} className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        Assignments
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <title>{`${title} · EduGemini`}</title>
        <h1 className="text-display font-semibold">{title}</h1>
        {saved && (
          <p className="inline-flex items-center gap-1 text-approved-fg">
            <CircleCheck aria-hidden size={16} />
            Draft saved
          </p>
        )}
      </div>
      <Stepper steps={STEPS} current={step} />
      {children}
    </div>
  );
}
