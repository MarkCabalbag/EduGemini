import { Link } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useAssignments } from '../hooks/use-assignments';
import { errorTextOf } from '../lib/error-text';
import { browserTimeZone, formatDue } from '../lib/zoned-time';

/**
 * A class's published assignments, nearest due date first, with each due date in the student's own time zone (App Flow §6
 * step 2, F13). The student's status chip on each row comes with the submission tickets.
 */
export function StudentAssignments({ classId }: { classId: string }) {
  const assignments = useAssignments(classId, 'PUBLISHED');
  const items = assignments.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">Assignments</h2>
      {assignments.isPending && <PageLoading />}
      {/* A first load that failed is an error. With assignments on screen, a failed "Show more" is said next to its button. */}
      {assignments.isError && !assignments.data && <ErrorState error={assignments.error} onRetry={() => void assignments.refetch()} />}
      {assignments.isSuccess && items.length === 0 && <p className="text-muted">No assignments yet.</p>}
      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((assignment) => (
            <li key={assignment.id}>
              <Link
                to={`/assignments/${assignment.id}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-input-border"
              >
                <span className="block font-semibold">{assignment.title}</span>
                <span className="block text-small text-muted">Due {formatDue(assignment.dueAt, browserTimeZone())}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {assignments.isFetchNextPageError && <Alert>{errorTextOf(assignments.error)}</Alert>}
      {assignments.hasNextPage && (
        <Button variant="secondary" loading={assignments.isFetchingNextPage} onClick={() => void assignments.fetchNextPage()}>
          Show more assignments
        </Button>
      )}
    </section>
  );
}
