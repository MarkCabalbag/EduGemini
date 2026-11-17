import { Users } from 'lucide-react';
import { useState } from 'react';
import type { ClassSummary, Decision, EnrollmentCounts, EnrollmentStatus, EnrollmentView } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CopyField } from '../components/ui/CopyField';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useApprovePending, useClassSettings, useDecision, usePeople } from '../hooks/use-people';
import { errorTextOf } from '../lib/error-text';

/** The four lists, and what the instructor can do to a student in each (UX Brief, People). */
type List = { label: string; count: keyof EnrollmentCounts; empty: string; actions: { action: Decision['action']; label: string }[] };
const LISTS: Record<EnrollmentStatus, List> = {
  PENDING: {
    label: 'Pending',
    count: 'pending',
    empty: 'No one is waiting for approval.',
    actions: [
      { action: 'APPROVE', label: 'Approve' },
      { action: 'DECLINE', label: 'Decline' },
    ],
  },
  ACTIVE: { label: 'Approved', count: 'approved', empty: 'No approved students yet.', actions: [{ action: 'REMOVE', label: 'Remove' }] },
  DECLINED: { label: 'Declined', count: 'declined', empty: 'No declined students.', actions: [{ action: 'REVERSE', label: 'Reverse' }] },
  REMOVED: { label: 'Removed', count: 'removed', empty: 'No removed students.', actions: [{ action: 'REVERSE', label: 'Reinstate' }] },
};
const ORDER: EnrollmentStatus[] = ['PENDING', 'ACTIVE', 'DECLINED', 'REMOVED'];

/** The join approval switch, and the offer to approve everyone who is still waiting once approval is off. Read-only once archived. */
function JoinApproval({ cls, pending }: { cls: ClassSummary; pending: number }) {
  const settings = useClassSettings(cls.id);
  const approveAll = useApprovePending(cls.id);
  const requireApproval = cls.requireApproval ?? false;
  const archived = cls.status === 'ARCHIVED';

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-title font-semibold">Join approval</h2>
      <Checkbox
        label="Require approval to join"
        helper="Turning this on doesn't change students who are already approved."
        checked={requireApproval}
        disabled={settings.isPending || archived}
        onChange={(event) => settings.mutate(event.target.checked)}
      />
      {settings.isError && <Alert>{errorTextOf(settings.error)}</Alert>}
      {!requireApproval && pending > 0 && !archived && (
        <div className="space-y-4">
          <Alert variant="info">
            {pending === 1 ? '1 student is' : `${pending} students are`} still waiting for approval. Turning approval off does not approve them.
          </Alert>
          <Button loading={approveAll.isPending} onClick={() => approveAll.mutate()}>
            Approve all pending
          </Button>
          {approveAll.isError && <Alert>{errorTextOf(approveAll.error)}</Alert>}
        </div>
      )}
    </section>
  );
}

/**
 * The students in one state, with the actions for that state, none once the class is archived. Removing asks first;
 * every other action goes straight through.
 */
function PeopleList({ cls, status }: { cls: ClassSummary; status: EnrollmentStatus }) {
  const list = LISTS[status];
  const actions = cls.status === 'ARCHIVED' ? [] : list.actions;
  const people = usePeople(cls.id, status);
  const decision = useDecision(cls.id);
  const [removing, setRemoving] = useState<EnrollmentView>();
  const rows = people.data?.pages.flatMap((page) => page.items) ?? [];

  if (people.isPending) return <PageLoading />;
  if (people.isError && !people.data) return <ErrorState error={people.error} onRetry={() => void people.refetch()} />;

  return (
    <div className="space-y-4">
      {decision.isError && <Alert>{errorTextOf(decision.error)}</Alert>}
      {rows.length === 0 && <p className="text-muted">{list.empty}</p>}
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{row.student.displayName}</p>
              <p className="break-all text-muted">{row.student.email}</p>
            </div>
            <div className="flex gap-2">
              {actions.map(({ action, label }) => (
                <Button
                  key={action}
                  variant={action === 'APPROVE' ? 'primary' : 'secondary'}
                  aria-label={`${label} ${row.student.displayName}`}
                  disabled={decision.isPending}
                  loading={decision.isPending && decision.variables.enrollmentId === row.id && decision.variables.action === action}
                  onClick={() => (action === 'REMOVE' ? setRemoving(row) : decision.mutate({ enrollmentId: row.id, action }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={() => setRemoving(undefined)}
          title={`Remove ${removing.student.displayName}?`}
          description={`${removing.student.displayName} will no longer see ${cls.name} in their classes. Their submissions are kept, and you can reinstate them at any time.`}
          confirmLabel="Remove"
          pending={decision.isPending}
          // The dialog closes when the request ends. A failure is said in the alert above the list.
          onConfirm={() => decision.mutate({ enrollmentId: removing.id, action: 'REMOVE' }, { onSettled: () => setRemoving(undefined) })}
        />
      )}
      {people.isFetchNextPageError && <Alert>{errorTextOf(people.error)}</Alert>}
      {people.hasNextPage && (
        <Button variant="secondary" loading={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
          Show more students
        </Button>
      )}
    </div>
  );
}

/** The class's people: join approval, and who is pending, approved, declined or removed (App Flow §4 step 4, PRD FR-CLS-05, FR-CLS-07). */
export function People({ cls }: { cls: ClassSummary }) {
  const counts = cls.counts ?? { approved: 0, pending: 0, declined: 0, removed: 0 };
  const [picked, setPicked] = useState<EnrollmentStatus>();
  // With requests waiting, they come first. Otherwise the instructor sees who is in.
  const status = picked ?? (counts.pending > 0 ? 'PENDING' : 'ACTIVE');
  const nobody = counts.approved + counts.pending + counts.declined + counts.removed === 0;

  return (
    <div className="space-y-6">
      <JoinApproval cls={cls} pending={counts.pending} />
      {nobody && cls.status === 'ACTIVE' && cls.joinCodeActive !== false && cls.joinCode && cls.joinLink ? (
        <EmptyState
          icon={Users}
          action={
            <div className="w-full space-y-4">
              <CopyField label="Class code" value={cls.joinCode} />
              <CopyField label="Join link" value={cls.joinLink} />
            </div>
          }
        >
          No students yet. Share the class code or join link to let students in.
        </EmptyState>
      ) : (
        <section className="space-y-4">
          <div role="group" aria-label="Students by status" className="flex flex-wrap gap-2">
            {ORDER.map((s) => (
              <Button key={s} variant={s === status ? 'primary' : 'secondary'} aria-pressed={s === status} onClick={() => setPicked(s)}>
                {LISTS[s].label} ({counts[LISTS[s].count]})
              </Button>
            ))}
          </div>
          <PeopleList key={status} cls={cls} status={status} />
        </section>
      )}
    </div>
  );
}
