import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { CopyField } from '../components/ui/CopyField';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useClass } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
import { NotFound } from './NotFound';

/** One class, as its instructor sees it: the details and the code and link to share (App Flow §4). */
export function ClassOverview() {
  const classId = useParams<'classId'>().classId!; // the route has :classId
  const cls = useClass(classId);

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
      {joinCode && joinLink && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-title font-semibold">Class code</h2>
          <CopyField label="Class code" value={joinCode} />
          <CopyField label="Join link" value={joinLink} />
        </section>
      )}
    </div>
  );
}
