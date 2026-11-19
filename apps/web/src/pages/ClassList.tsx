import { BookOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useClasses } from '../hooks/use-classes';
import { classMeta } from '../lib/class-meta';
import { errorTextOf } from '../lib/error-text';
import { PAPER_HEADING } from '../lib/paper';

function CreateClassLink() {
  return (
    <Link to="/classes/new" className={buttonClass()}>
      <Plus aria-hidden size={20} />
      Create class
    </Link>
  );
}

/**
 * The whole card is one link to the class (UX Brief §9.3), drawn as a card on the paper (index.css, .paper-card). An
 * archived class carries "Archived" in the teacher's hand, still as words.
 */
function ClassCard({ cls }: { cls: ClassSummary }) {
  const meta = classMeta(cls);
  return (
    <Link to={`/classes/${cls.id}`} className="paper-card min-h-[108px]">
      <h2 className={`truncate text-title leading-9 font-bold ${cls.status === 'ARCHIVED' ? 'pr-24' : ''}`}>{cls.name}</h2>
      {cls.status === 'ARCHIVED' && (
        <span className="absolute top-3 right-4 -rotate-[4deg] font-hand text-2xl leading-9 text-[var(--margin-red)]">Archived</span>
      )}
      {meta && <p className="text-muted">{meta}</p>}
    </Link>
  );
}

/** The instructor's dashboard: their active classes, or their archived ones when asked for (App Flow §3). */
export function ClassList() {
  const [showArchived, setShowArchived] = useState(false);
  const classes = useClasses(showArchived ? 'ARCHIVED' : 'ACTIVE');
  const items = classes.data?.pages.flatMap((page) => page.items) ?? [];
  const isEmpty = classes.isSuccess && items.length === 0;
  const firstTime = isEmpty && !showArchived; // the empty state has a Create class button of its own

  return (
    <div className="space-y-[18px] pl-6 leading-9 sm:pl-12">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-[18px]">
        <title>My classes · EduGemini</title>
        <h1 className={PAPER_HEADING}>My classes</h1>
        <div className="flex flex-wrap items-center gap-4">
          {/* Always shown: an instructor who archived their only class has no active ones, and still needs a way back to it. */}
          <Checkbox label="Show archived" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          {!firstTime && <CreateClassLink />}
        </div>
      </div>

      {classes.isPending && <PageLoading />}
      {/* A first load that failed is an error screen. With classes on screen, a failed refresh is ignored and a failed
          "Show more" is said next to its button, so Retry asks for that page only. */}
      {classes.isError && !classes.data && <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />}
      {firstTime && (
        <EmptyState icon={BookOpen} action={<CreateClassLink />}>
          No classes yet. Create one to share a code with your students.
        </EmptyState>
      )}
      {isEmpty && showArchived && <p className="text-muted">No archived classes.</p>}
      {items.length > 0 && (
        <ul className="grid gap-x-6 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((cls) => (
            <li key={cls.id}>
              <ClassCard cls={cls} />
            </li>
          ))}
        </ul>
      )}
      {classes.isFetchNextPageError && <Alert>{errorTextOf(classes.error)}</Alert>}
      {classes.hasNextPage && (
        <Button variant="secondary" loading={classes.isFetchingNextPage} onClick={() => void classes.fetchNextPage()}>
          Show more classes
        </Button>
      )}
    </div>
  );
}
