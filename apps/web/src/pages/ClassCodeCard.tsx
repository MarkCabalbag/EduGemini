import { useState } from 'react';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CopyField } from '../components/ui/CopyField';
import { useChangeCode } from '../hooks/use-classes';
import { errorTextOf } from '../lib/error-text';

// Both ask first, and both say the students already in are not affected (UX Brief, Class Overview).
const ASKS = {
  regenerate: {
    title: 'Regenerate the class code?',
    description:
      'A new code and join link are made, and the old ones stop working at once. Students already in the class are not affected.',
    confirmLabel: 'Regenerate code',
  },
  disable: {
    title: 'Disable the class code?',
    description:
      'Nobody can join with the code or the join link until you regenerate the code. Students already in the class are not affected.',
    confirmLabel: 'Disable code',
  },
} as const;

/**
 * The Class code section on Overview: the code (one character per box) and the link to share, on one column so both Copy
 * buttons line up, and the controls to regenerate or disable them (API Spec CLS-08, CLS-09). Not shown for an archived class.
 */
export function ClassCodeCard({ cls }: { cls: ClassSummary }) {
  const change = useChangeCode(cls.id);
  const [asking, setAsking] = useState<keyof typeof ASKS>();
  const { joinCode, joinLink } = cls;
  if (!joinCode || !joinLink) return null; // only the owning instructor is sent them

  const off = cls.joinCodeActive === false;
  return (
    <section className="share-fields">
      <h2 className="text-title leading-9 font-bold">Class code</h2>
      {off ? (
        // A switched-off code is not offered for sharing. Regenerating is how it is switched on again.
        <div className="mb-[18px]">
          <Alert variant="info">
            The class code is off. Nobody can join with the code or the join link. Regenerate the code to turn it on again.
          </Alert>
        </div>
      ) : (
        <>
          <CopyField label="Class code" value={joinCode} boxes hideLabel />
          <CopyField label="Join link" value={joinLink} />
        </>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-[18px] pb-[18px]">
        <Button variant="secondary" onClick={() => setAsking('regenerate')}>
          Regenerate code
        </Button>
        {!off && (
          <Button variant="secondary" onClick={() => setAsking('disable')}>
            Disable code
          </Button>
        )}
      </div>
      {change.isError && <Alert>{errorTextOf(change.error)}</Alert>}
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={() => setAsking(undefined)}
          {...ASKS[asking]}
          pending={change.isPending}
          // The dialog closes when the request ends. A failure is said in the alert under the section.
          onConfirm={() => change.mutate(asking, { onSettled: () => setAsking(undefined) })}
        />
      )}
    </section>
  );
}
