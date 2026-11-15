import { BookOpen, Plus } from 'lucide-react';
import { Link } from 'react-router';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useClasses } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { classMeta } from '../lib/class-meta';
import { errorText } from '../lib/error-text';

function CreateClassLink() {
  return (
    <Link to="/classes/new" className={buttonClass()}>
      <Plus aria-hidden size={20} />
      Create class
    </Link>
  );
}

/** The whole card is one link to the class (UX Brief §9.3). */
function ClassCard({ cls }: { cls: ClassSummary }) {
  const meta = classMeta(cls);
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="block rounded-lg border border-border bg-surface p-4 shadow-raised hover:border-input-border"
    >
      <h2 className="text-title font-semibold">{cls.name}</h2>
      {meta && <p className="text-muted">{meta}</p>}
    </Link>
  );
}

/** The instructor's dashboard: their active classes (App Flow §3). */
export function ClassList() {
  const classes = useClasses();
  const items = classes.data?.pages.flatMap((page) => page.items) ?? [];
  const isEmpty = classes.isSuccess && items.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-display font-semibold">My classes</h1>
        {!isEmpty && <CreateClassLink />}
      </div>

      {classes.isPending && <PageLoading />}
      {/* A first load that failed is an error screen. With classes on screen, a failed refresh is ignored and a failed
          "Show more" is said next to its button, so Retry asks for that page only. */}
      {classes.isError && !classes.data && <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />}
      {isEmpty && (
        <EmptyState icon={BookOpen} action={<CreateClassLink />}>
          No classes yet. Create one to share a code with your students.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((cls) => (
            <li key={cls.id}>
              <ClassCard cls={cls} />
            </li>
          ))}
        </ul>
      )}
      {classes.isFetchNextPageError && <Alert>{errorText(classes.error instanceof ApiRequestError ? classes.error.code : 'INTERNAL')}</Alert>}
      {classes.hasNextPage && (
        <Button variant="secondary" loading={classes.isFetchingNextPage} onClick={() => void classes.fetchNextPage()}>
          Show more classes
        </Button>
      )}
    </div>
  );
}
