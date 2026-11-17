import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useArchiveClass, useClass } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
import { errorTextOf } from '../lib/error-text';
import { Assignments } from './Assignments';
import { ClassCodeCard } from './ClassCodeCard';
import { DeleteClass } from './DeleteClass';
import { EditClassDetails } from './EditClassDetails';
import { NotFound } from './NotFound';
import { People } from './People';

/** The sections of the class page, one at a time, chosen by `?tab=` (TRD §15.1). More arrive with their tickets. */
function SectionLink({ to, current, children }: { to: string; current: boolean; children: string }) {
  const style = current ? 'border-primary text-primary' : 'border-transparent text-muted';
  return (
    <Link to={to} aria-current={current ? 'page' : undefined} className={`inline-flex min-h-11 items-center border-b-2 px-3 font-semibold ${style}`}>
      {children}
    </Link>
  );
}

/**
 * Archive asks first; restore does not (UX Brief §10.2). An archived class is read-only for everyone and its code stops
 * working (API Spec CLS-05, CLS-06).
 */
function ArchiveCard({ cls }: { cls: ClassSummary }) {
  const archive = useArchiveClass(cls.id);
  const [asking, setAsking] = useState(false);
  const archived = cls.status === 'ARCHIVED';

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-title font-semibold">{archived ? 'Archived class' : 'Danger zone'}</h2>
      {archived ? (
        <>
          <p>This class is archived and read-only. Students can still open it and see their work.</p>
          <Button loading={archive.isPending} onClick={() => archive.mutate(false)}>
            Restore class
          </Button>
        </>
      ) : (
        <>
          <p>Archiving makes the class read-only and stops its class code from working. You can restore it at any time.</p>
          <Button variant="secondary" onClick={() => setAsking(true)}>
            Archive class
          </Button>
        </>
      )}
      {archive.isError && <Alert>{errorTextOf(archive.error)}</Alert>}
      <DeleteClass cls={cls} />
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={() => setAsking(false)}
          title={`Archive ${cls.name}?`}
          description="The class becomes read-only. Students can still open it and see their work, but nobody can change anything, and the class code stops working. You can restore it at any time."
          confirmLabel="Archive class"
          pending={archive.isPending}
          // The dialog closes when the request ends. A failure is said in the alert on the card.
          onConfirm={() => archive.mutate(true, { onSettled: () => setAsking(false) })}
        />
      )}
    </section>
  );
}

/** One class, as its instructor sees it: the details, the code and link to share, and its people (App Flow §4). */
export function ClassOverview() {
  const classId = useParams<'classId'>().classId!; // the route has :classId
  const cls = useClass(classId);
  const tab = useSearchParams()[0].get('tab');
  const onAssignments = tab === 'assignments';
  const onPeople = tab === 'people';
  const onOverview = !onAssignments && !onPeople;

  if (cls.isPending) return <PageLoading />;
  if (cls.isError) {
    // Someone else's class, a student, a class that does not exist and an address that is not an id all look the same (API Spec A3).
    const notFound = cls.error instanceof ApiRequestError && (cls.error.code === 'NOT_FOUND' || cls.error.code === 'VALIDATION');
    return notFound ? <NotFound /> : <ErrorState error={cls.error} onRetry={() => void cls.refetch()} />;
  }

  const { name, description } = cls.data;
  const archived = cls.data.status === 'ARCHIVED';
  const meta = classMeta(cls.data);

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/classes" className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        My classes
      </Link>
      <div className="space-y-2">
        <title>{`${name} · EduGemini`}</title>
        <h1 className="text-display font-semibold">{name}</h1>
        {archived && <StatusChip tone="info">Archived</StatusChip>}
        {meta && <p className="text-muted">{meta}</p>}
        {description && <p className="whitespace-pre-line">{description}</p>}
      </div>
      <nav aria-label="Class sections" className="flex border-b border-border">
        <SectionLink to={`/classes/${classId}`} current={onOverview}>
          Overview
        </SectionLink>
        <SectionLink to={`/classes/${classId}?tab=assignments`} current={onAssignments}>
          Assignments
        </SectionLink>
        <SectionLink to={`/classes/${classId}?tab=people`} current={onPeople}>
          People
        </SectionLink>
      </nav>
      {onAssignments && <Assignments cls={cls.data} />}
      {onPeople && <People cls={cls.data} />}
      {/* An archived class's code does not work, and the class is read-only, so the code card is not shown. */}
      {onOverview && !archived && <ClassCodeCard cls={cls.data} />}
      {/* An archived class is read-only, so its details cannot be edited until it is restored. */}
      {onOverview && !archived && <EditClassDetails cls={cls.data} />}
      {onOverview && <ArchiveCard cls={cls.data} />}
    </div>
  );
}
