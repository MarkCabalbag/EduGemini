import { ArrowLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CopyField } from '../components/ui/CopyField';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useClass } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
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

/** One class, as its instructor sees it: the details, the code and link to share, and its people (App Flow §4). */
export function ClassOverview() {
  const classId = useParams<'classId'>().classId!; // the route has :classId
  const cls = useClass(classId);
  const onPeople = useSearchParams()[0].get('tab') === 'people';

  if (cls.isPending) return <PageLoading />;
  if (cls.isError) {
    // Someone else's class, a student, a class that does not exist and an address that is not an id all look the same (API Spec A3).
    const notFound = cls.error instanceof ApiRequestError && (cls.error.code === 'NOT_FOUND' || cls.error.code === 'VALIDATION');
    return notFound ? <NotFound /> : <ErrorState error={cls.error} onRetry={() => void cls.refetch()} />;
  }

  const { name, description, joinCode, joinLink } = cls.data;
  const meta = classMeta(cls.data);

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/classes" className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        My classes
      </Link>
      <div className="space-y-2">
        <h1 className="text-display font-semibold">{name}</h1>
        {meta && <p className="text-muted">{meta}</p>}
        {description && <p className="whitespace-pre-line">{description}</p>}
      </div>
      <nav aria-label="Class sections" className="flex border-b border-border">
        <SectionLink to={`/classes/${classId}`} current={!onPeople}>
          Overview
        </SectionLink>
        <SectionLink to={`/classes/${classId}?tab=people`} current={onPeople}>
          People
        </SectionLink>
      </nav>
      {onPeople && <People cls={cls.data} />}
      {!onPeople && joinCode && joinLink && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-title font-semibold">Class code</h2>
          <CopyField label="Class code" value={joinCode} />
          <CopyField label="Join link" value={joinLink} />
        </section>
      )}
    </div>
  );
}
