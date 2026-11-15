import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useClass } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
import { NotFound } from './NotFound';

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/classes" className="inline-flex items-center gap-1 font-semibold text-primary underline">
        <ArrowLeft aria-hidden size={16} />
        My classes
      </Link>
      {children}
    </div>
  );
}

/** One class, as a student in it sees it (App Flow §6 step 2). The assignments come with their own tickets. */
export function StudentClass() {
  const classId = useParams<'classId'>().classId!; // the route has :classId
  const cls = useClass(classId);

  if (cls.isPending) return <PageLoading />;
  if (cls.isError) {
    const error = cls.error;
    if (error instanceof ApiRequestError && error.code === 'ENROLLMENT_PENDING') {
      // A pending student is told the class name and nothing else (API Spec CLS-03).
      return (
        <Page>
          <h1 className="text-display font-semibold">{String(error.details?.['className'] ?? '')}</h1>
          <Alert variant="info">Pending approval. Your instructor will review your request.</Alert>
        </Page>
      );
    }
    // A declined or removed student, a stranger, a class that does not exist and an address that is not an id all look the same (API Spec A3).
    const notFound = error instanceof ApiRequestError && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION');
    return notFound ? <NotFound /> : <ErrorState error={error} onRetry={() => void cls.refetch()} />;
  }

  const { name, description, instructorName, status } = cls.data;
  const meta = classMeta(cls.data);

  return (
    <Page>
      <div className="space-y-2">
        <h1 className="text-display font-semibold">{name}</h1>
        {status === 'ARCHIVED' && <StatusChip tone="info">Archived</StatusChip>}
        {instructorName && <p className="text-muted">Taught by {instructorName}</p>}
        {meta && <p className="text-muted">{meta}</p>}
        {description && <p className="whitespace-pre-line">{description}</p>}
      </div>
    </Page>
  );
}
