import { FileText, Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import type { AssignmentSummary, ClassSummary, PublishWarning } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { StatusChip } from '../components/ui/StatusChip';
import { useAssignments } from '../hooks/use-assignments';
import { ApiRequestError } from '../lib/api';
import { resubmissionText, scoringText } from '../lib/assignment-meta';
import { errorText } from '../lib/error-text';
import { formatDue } from '../lib/zoned-time';

// What publishing warns about (App Flow §5.1, F16). It never blocks.
const WARNINGS: Record<PublishWarning, string> = {
  DUE_IN_PAST: 'The due date has already passed, so every submission will be marked Late.',
  NO_VALID_KEY: 'No Gemini key is connected, so submissions will wait for your review instead of being graded by AI.',
};

/** The wizard hands this over when it publishes. It is a notice for now, so it is gone after a reload. */
function PublishedNotice() {
  const published = (useLocation().state as { published?: { title: string; warnings: PublishWarning[] } } | null)?.published;
  if (!published) return null;
  return (
    <Alert variant="info">
      <p>{published.title} is published. Approved students can see it now.</p>
      {published.warnings.map((warning) => (
        <p key={warning}>{WARNINGS[warning]}</p>
      ))}
    </Alert>
  );
}

function NewAssignmentLink({ classId }: { classId: string }) {
  return (
    <Link to={`/classes/${classId}/assignments/new`} className={buttonClass()}>
      <Plus aria-hidden size={20} />
      New assignment
    </Link>
  );
}

/** A draft has Resume, a published assignment has Edit. The row itself is not a link yet: it opens the tracker, which comes with its own ticket. */
function AssignmentRow({ assignment, canEdit }: { assignment: AssignmentSummary; canEdit: boolean }) {
  const draft = assignment.status === 'DRAFT';
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="space-y-1">
        <p className="font-semibold">{assignment.title}</p>
        <p className="text-small text-muted">
          Due {formatDue(assignment.dueAt, assignment.timezone)} · {scoringText(assignment)} · {resubmissionText(assignment)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {draft && <StatusChip tone="pending">Draft</StatusChip>}
        {canEdit && (
          <Link
            to={`/assignments/${assignment.id}/edit`}
            aria-label={`${draft ? 'Resume' : 'Edit'} ${assignment.title}`}
            className={buttonClass('secondary')}
          >
            {draft ? 'Resume' : 'Edit'}
          </Link>
        )}
      </div>
    </li>
  );
}

/** One status's assignments, with "Show more" for the next page. Nothing at all when there are none. */
function Group({ heading, query, canEdit }: { heading: string; query: ReturnType<typeof useAssignments>; canEdit: boolean }) {
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-title font-semibold">{heading}</h3>
      <ul className="space-y-3">
        {rows.map((assignment) => (
          <AssignmentRow key={assignment.id} assignment={assignment} canEdit={canEdit} />
        ))}
      </ul>
      {query.isFetchNextPageError && <Alert>{errorText(query.error instanceof ApiRequestError ? query.error.code : 'INTERNAL')}</Alert>}
      {query.hasNextPage && (
        <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Show more {heading.toLowerCase()}
        </Button>
      )}
    </section>
  );
}

/** The class's assignments: drafts above published ones, nearest due date first (UX Brief, Assignments tab). An archived class is read-only. */
export function Assignments({ cls }: { cls: ClassSummary }) {
  const archived = cls.status === 'ARCHIVED';
  const drafts = useAssignments(cls.id, 'DRAFT');
  const published = useAssignments(cls.id, 'PUBLISHED');

  const failed = [drafts, published].find((query) => query.isError && !query.data);
  const isEmpty = [drafts, published].every((query) => query.isSuccess && query.data.pages.every((page) => page.items.length === 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-title font-semibold">Assignments</h2>
        {!archived && !isEmpty && <NewAssignmentLink classId={cls.id} />}
      </div>
      <PublishedNotice />

      {failed && <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />}
      {!failed && (drafts.isPending || published.isPending) && <PageLoading />}
      {isEmpty &&
        (archived ? (
          <p className="text-muted">No assignments.</p>
        ) : (
          <EmptyState icon={FileText} action={<NewAssignmentLink classId={cls.id} />}>
            Create your first assignment.
          </EmptyState>
        ))}
      <Group heading="Drafts" query={drafts} canEdit={!archived} />
      <Group heading="Published" query={published} canEdit={!archived} />
    </div>
  );
}
