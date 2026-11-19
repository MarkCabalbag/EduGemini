import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useArchiveClass, useClass } from '../hooks/use-classes';
import { usePaperPage } from '../hooks/use-paper-page';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
import { errorTextOf } from '../lib/error-text';
import { PAPER_HEADING } from '../lib/paper';
import { Assignments } from './Assignments';
import { ClassCodeCard } from './ClassCodeCard';
import { DeleteClass } from './DeleteClass';
import { EditClassDetails } from './EditClassDetails';
import { NotFound } from './NotFound';
import { People } from './People';

/**
 * The sections of the class page, one at a time, chosen by `?tab=` (TRD §15.1): words on one ruled line, the current one
 * with an ink bar lying on that line (index.css, .class-tabs).
 */
function SectionLink({ to, current, children }: { to: string; current: boolean; children: string }) {
  return (
    <Link to={to} aria-current={current ? 'page' : undefined} className="class-tab">
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
    // Spans the page under a red line, on the same two columns as above: archive or restore on the left, delete on the right.
    // An archived class shows nothing above this section, so it starts one row of air below the tabs.
    <section
      className={`danger-zone ${archived ? 'is-archived mt-9' : ''} grid gap-x-[72px] gap-y-[72px] lg:grid-cols-[minmax(0,1fr)_20rem]`}
    >
      <div>
        <h2 className="text-title leading-9 font-bold">{archived ? 'Archived class' : 'Danger zone'}</h2>
        {archived ? (
          <>
            <p>This class is archived and read-only. Students can still open it and see their work.</p>
            <div className="mt-[18px]">
              <Button loading={archive.isPending} onClick={() => archive.mutate(false)}>
                Restore class
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>Archiving makes the class read-only and stops its class code from working. You can restore it at any time.</p>
            <div className="mt-[18px]">
              <Button variant="secondary" onClick={() => setAsking(true)}>
                Archive class
              </Button>
            </div>
          </>
        )}
        {archive.isError && (
          <div className="mt-[18px]">
            <Alert>{errorTextOf(archive.error)}</Alert>
          </div>
        )}
      </div>
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
  usePaperPage();
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
    // One grid on the paper: every block is a whole number of 36 px rows, so all text sits on the ruled lines.
    <div className="pl-6 leading-9 sm:pl-12">
      <Link to="/classes" className="flex h-9 w-max items-center gap-1.5 font-semibold text-primary underline underline-offset-4">
        <ArrowLeft aria-hidden size={16} />
        My classes
      </Link>
      <div>
        <title>{`${name} · EduGemini`}</title>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <h1 className={PAPER_HEADING}>{name}</h1>
          {archived && <span className="-rotate-[4deg] font-hand text-[1.625rem] leading-9 text-[var(--margin-red)]">Archived</span>}
        </div>
        {meta && <p className="text-muted">{meta}</p>}
        {description && <p className="max-w-[72ch] whitespace-pre-line">{description}</p>}
      </div>
      <nav aria-label="Class sections" className="class-tabs mt-9">
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
      {/* Padding, not margin: a section's own top margin (the archived one) must add to this gap, not collapse into it. */}
      <div className="pt-9">
        {onAssignments && <Assignments cls={cls.data} />}
        {onPeople && <People cls={cls.data} />}
        {onOverview && (
          <>
            {/* An archived class's code does not work and its details cannot be edited, so neither is shown until it is restored. */}
            {!archived && (
              <div className="mb-[72px] grid gap-x-[72px] gap-y-[72px] lg:grid-cols-[minmax(0,1fr)_20rem]">
                <ClassCodeCard cls={cls.data} />
                <EditClassDetails cls={cls.data} />
              </div>
            )}
            <ArchiveCard cls={cls.data} />
          </>
        )}
      </div>
    </div>
  );
}
