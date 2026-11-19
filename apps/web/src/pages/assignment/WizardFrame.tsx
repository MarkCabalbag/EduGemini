import { ArrowLeft, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Stepper } from '../../components/ui/Stepper';
import { usePaperPage } from '../../hooks/use-paper-page';
import { PAPER_HEADING } from '../../lib/paper';

export const STEPS = ['Basics', 'Criteria', 'Due date and scoring', 'Rules', 'Review'];

/**
 * What every step sits in, on the Marked Script paper: the way back to the class, the title, "Draft saved" after a save,
 * then the step's form on the left and the steps down the right (above the form on phones) (UX Brief, wizard).
 */
export function WizardFrame({ classId, title, step, children }: { classId: string; title: string; step: number; children: ReactNode }) {
  usePaperPage();
  // A step that has just been saved hands this on when it moves to the next one.
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;
  return (
    <div className="pl-6 leading-9 sm:pl-12">
      <Link
        to={`/classes/${classId}?tab=assignments`}
        className="flex h-9 w-max items-center gap-1.5 font-semibold text-primary underline underline-offset-4"
      >
        <ArrowLeft aria-hidden size={16} />
        Assignments
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-6">
        <title>{`${title} · EduGemini`}</title>
        <h1 className={PAPER_HEADING}>{title}</h1>
        {saved && (
          <p className="inline-flex items-center gap-1.5 font-hand text-2xl leading-9 text-[var(--margin-red,var(--primary))]">
            <Check aria-hidden size={20} strokeWidth={3} />
            Draft saved
          </p>
        )}
      </div>
      <div className="grid gap-x-[72px] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Stepper steps={STEPS} current={step} className="mb-9 lg:order-2 lg:mb-0" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
