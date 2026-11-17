import { ArrowLeft, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AssignmentDetail } from '@edugemini/shared';
import { BasicsStep } from './BasicsStep';
import { DueScoringStep } from './DueScoringStep';
import { RulesStep } from './RulesStep';

/**
 * A published assignment (App Flow §5.2): the title, instructions, due date, scoring and rules change here, each part saved
 * on its own and applied at once. The criteria are not here yet: changing them needs the re-grade confirmation (ASG-04).
 */
export function PublishedEdit({ assignment }: { assignment: AssignmentDetail }) {
  const [saved, setSaved] = useState<string>();
  const part = (name: string) => ({ assignment, submitLabel: 'Save changes', onSaved: () => setSaved(`${name} saved.`) });

  return (
    <div className="max-w-2xl space-y-8">
      <Link to={`/classes/${assignment.classId}?tab=assignments`} className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        Assignments
      </Link>
      <div className="space-y-2">
        <title>{`${assignment.title} · EduGemini`}</title>
        <h1 className="text-display font-semibold">{assignment.title}</h1>
        <p>This assignment is published, so changes apply right away. The grading criteria cannot be changed yet.</p>
        {/* Always on the page, so a screen reader announces the text when it appears. Any new save clears it. */}
        <p role="status" className="inline-flex min-h-6 items-center gap-1 text-approved-fg">
          {saved && (
            <>
              <CircleCheck aria-hidden size={16} />
              {saved}
            </>
          )}
        </p>
      </div>
      <section aria-labelledby="published-basics" className="space-y-4" onSubmitCapture={() => setSaved(undefined)}>
        <h2 id="published-basics" className="text-title font-semibold">
          Basics
        </h2>
        <BasicsStep {...part('Basics')} />
      </section>
      <section aria-labelledby="published-due" className="space-y-4" onSubmitCapture={() => setSaved(undefined)}>
        <h2 id="published-due" className="text-title font-semibold">
          Due date and scoring
        </h2>
        <DueScoringStep {...part('Due date and scoring')} />
      </section>
      <section aria-labelledby="published-rules" className="space-y-4" onSubmitCapture={() => setSaved(undefined)}>
        <h2 id="published-rules" className="text-title font-semibold">
          Rules
        </h2>
        <RulesStep {...part('Rules')} />
      </section>
    </div>
  );
}
