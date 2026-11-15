import { useMe } from '../hooks/use-auth';
import { ClassList } from './ClassList';

const ROLE_TEXT = { INSTRUCTOR: 'an instructor', STUDENT: 'a student', SUPER_ADMIN: 'an admin' } as const;

/** Instructors see their classes. Everyone else sees a placeholder until students can join (EG-CLS-04, EG-CLS-06). */
export function Dashboard() {
  const me = useMe().data;
  if (!me) return null;
  if (me.role === 'INSTRUCTOR') return <ClassList />;

  return (
    <div className="space-y-4">
      <h1 className="text-display font-semibold">Welcome, {me.firstName}</h1>
      <p className="text-muted">You are signed in as {ROLE_TEXT[me.role]}. Your classes will appear here.</p>
    </div>
  );
}
