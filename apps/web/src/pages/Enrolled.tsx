import { Check, GraduationCap } from 'lucide-react';
import { Link } from 'react-router';
import type { EnrollmentStatus, EnrollmentSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useEnrollments } from '../hooks/use-classes';
import { errorTextOf } from '../lib/error-text';

/**
 * Each enrollment state, written in the teacher's hand on the card (UX Brief §8.4): always words, with a tick beside
 * Approved and a red strike through Declined. A removed student's class is not listed, so that row is never shown.
 */
const STATUS: Record<EnrollmentStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Approved', className: 'text-[var(--margin-red)]' },
  PENDING: { label: 'Pending approval', className: 'text-muted' },
  DECLINED: { label: 'Declined', className: 'text-muted line-through decoration-[var(--margin-red)] decoration-2' },
  REMOVED: { label: 'Removed', className: 'text-muted' },
};

/** One class. Only an approved class opens; the others show their status and no content (App Flow §3). */
function EnrolledCard({ item }: { item: EnrollmentSummary }) {
  const status = STATUS[item.status];
  const content = (
    <>
      <h3 className="truncate text-title leading-9 font-bold">{item.className}</h3>
      <p className="text-muted">Taught by {item.instructorName}</p>
      <p className="flex flex-wrap items-center gap-x-4 font-hand text-2xl leading-9">
        <span className={`inline-flex items-center gap-1.5 ${status.className}`}>
          {item.status === 'ACTIVE' && <Check aria-hidden size={22} strokeWidth={3} />}
          {status.label}
        </span>
        {item.archived && <span className="-rotate-[4deg] text-[var(--margin-red)]">Archived</span>}
      </p>
      {item.status === 'PENDING' && <p>Your instructor will review your request.</p>}
    </>
  );

  return item.status === 'ACTIVE' ? (
    <Link to={`/classes/${item.classId}`} className="paper-card min-h-[144px]">
      {content}
    </Link>
  ) : (
    <div className="paper-card still min-h-[144px]">{content}</div>
  );
}

/** The student's classes, each with its status (App Flow §3, PRD FR-CLS-08). */
export function Enrolled() {
  const enrollments = useEnrollments();
  const items = enrollments.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-[18px]">
      <h2 className="text-title leading-9 font-bold">My classes</h2>
      {enrollments.isPending && <PageLoading />}
      {/* Same rule as the instructor's list: a failed first load is an error screen; a failed "Show more" is said next to its button. */}
      {enrollments.isError && !enrollments.data && <ErrorState error={enrollments.error} onRetry={() => void enrollments.refetch()} />}
      {enrollments.isSuccess && items.length === 0 && (
        <EmptyState icon={GraduationCap} action={null}>
          You haven&apos;t joined a class yet. Enter a class code above to join one.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="grid gap-x-6 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.classId}>
              <EnrolledCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {enrollments.isFetchNextPageError && <Alert>{errorTextOf(enrollments.error)}</Alert>}
      {enrollments.hasNextPage && (
        <Button variant="secondary" loading={enrollments.isFetchingNextPage} onClick={() => void enrollments.fetchNextPage()}>
          Show more classes
        </Button>
      )}
    </section>
  );
}
