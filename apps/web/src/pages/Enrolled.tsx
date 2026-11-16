import { GraduationCap } from 'lucide-react';
import { Link } from 'react-router';
import type { EnrollmentStatus, EnrollmentSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useEnrollments } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { errorText } from '../lib/error-text';

/** The chip for each enrollment state (UX Brief §8.4). A removed student's class is not listed, so that row is never shown. */
const STATUS: Record<EnrollmentStatus, { tone: 'approved' | 'pending' | 'info'; label: string }> = {
  ACTIVE: { tone: 'approved', label: 'Approved' },
  PENDING: { tone: 'pending', label: 'Pending approval' },
  DECLINED: { tone: 'info', label: 'Declined' },
  REMOVED: { tone: 'info', label: 'Removed' },
};

/** One class. Only an approved class opens; the others show their status and no content (App Flow §3). */
function EnrolledCard({ item }: { item: EnrollmentSummary }) {
  const chip = STATUS[item.status];
  const card = 'block rounded-lg border border-border bg-surface p-4 shadow-raised';
  const content = (
    <>
      <h3 className="text-title font-semibold">{item.className}</h3>
      <p className="text-muted">Taught by {item.instructorName}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        {item.archived && <StatusChip tone="info">Archived</StatusChip>}
      </div>
      {item.status === 'PENDING' && <p className="mt-2">Your instructor will review your request.</p>}
    </>
  );

  return item.status === 'ACTIVE' ? (
    <Link to={`/classes/${item.classId}`} className={`${card} hover:border-input-border`}>
      {content}
    </Link>
  ) : (
    <div className={card}>{content}</div>
  );
}

/** The student's classes, each with its status (App Flow §3, PRD FR-CLS-08). */
export function Enrolled() {
  const enrollments = useEnrollments();
  const items = enrollments.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-4">
      <h2 className="text-title font-semibold">My classes</h2>
      {enrollments.isPending && <PageLoading />}
      {/* Same rule as the instructor's list: a failed first load is an error screen; a failed "Show more" is said next to its button. */}
      {enrollments.isError && !enrollments.data && <ErrorState error={enrollments.error} onRetry={() => void enrollments.refetch()} />}
      {enrollments.isSuccess && items.length === 0 && (
        <EmptyState icon={GraduationCap} action={null}>
          You haven&apos;t joined a class yet. Enter a class code above to join one.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.classId}>
              <EnrolledCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {enrollments.isFetchNextPageError && (
        <Alert>{errorText(enrollments.error instanceof ApiRequestError ? enrollments.error.code : 'INTERNAL')}</Alert>
      )}
      {enrollments.hasNextPage && (
        <Button variant="secondary" loading={enrollments.isFetchingNextPage} onClick={() => void enrollments.fetchNextPage()}>
          Show more classes
        </Button>
      )}
    </section>
  );
}
