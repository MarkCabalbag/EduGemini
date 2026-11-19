import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AssignmentDetail } from '@edugemini/shared';
import { usePaperPage } from '../../hooks/use-paper-page';
import { PAPER_HEADING } from '../../lib/paper';
import { BasicsStep } from './BasicsStep';
import { DueScoringStep } from './DueScoringStep';
import { ReferenceFiles } from './ReferenceFiles';
import { RulesStep } from './RulesStep';

const PART_HEADING = 'text-title leading-9 font-bold';

/**
 * A published assignment (App Flow §5.2), on the Marked Script paper: the title, instructions, due date, scoring and rules
 * change here, each part saved on its own and applied at once, in two columns on wide screens. The criteria are not here yet:
 * changing them needs the re-grade confirmation (ASG-04).
 */
export function PublishedEdit({ assignment }: { assignment: AssignmentDetail }) {
  usePaperPage();
  const [saved, setSaved] = useState<string>();
  const part = (name: string) => ({ assignment, submitLabel: 'Save changes', onSaved: () => setSaved(`${name} saved.`) });

  return (
    <div className="pl-6 leading-9 sm:pl-12">
      <Link
        to={`/classes/${assignment.classId}?tab=assignments`}
        className="flex h-9 w-max items-center gap-1.5 font-semibold text-primary underline underline-offset-4"
      >
        <ArrowLeft aria-hidden size={16} />
        Assignments
      </Link>
      <title>{`${assignment.title} · EduGemini`}</title>
      <h1 className={PAPER_HEADING}>{assignment.title}</h1>
      <p className="max-w-[72ch]">
        This assignment is published, so changes apply right away. The grading criteria cannot be changed yet, and neither can the reference
        files, except who sees them.
      </p>
      {/* Always on the page, so a screen reader announces the text when it appears. Any new save clears it. */}
      <p
        role="status"
        className="mb-9 flex min-h-9 items-center gap-1.5 font-hand text-2xl leading-9 text-[var(--margin-red,var(--primary))]"
      >
        {saved && (
          <>
            <Check aria-hidden size={20} strokeWidth={3} />
            {saved}
          </>
        )}
      </p>
      <div className="grid items-start gap-x-[72px] gap-y-9 lg:grid-cols-2">
        <section aria-labelledby="published-basics" onSubmitCapture={() => setSaved(undefined)}>
          <h2 id="published-basics" className={PART_HEADING}>
            Basics
          </h2>
          <BasicsStep {...part('Basics')} />
        </section>
        <section aria-labelledby="published-due" onSubmitCapture={() => setSaved(undefined)}>
          <h2 id="published-due" className={PART_HEADING}>
            Due date and scoring
          </h2>
          <DueScoringStep {...part('Due date and scoring')} />
        </section>
        <ReferenceFiles assignment={assignment} canChange={false} />
        <section aria-labelledby="published-rules" onSubmitCapture={() => setSaved(undefined)}>
          <h2 id="published-rules" className={PART_HEADING}>
            Rules
          </h2>
          <RulesStep {...part('Rules')} />
        </section>
      </div>
    </div>
  );
}
