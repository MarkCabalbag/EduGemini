import { useMe } from '../hooks/use-auth';
import { ClassList } from './ClassList';
import { JoinClass } from './JoinClass';

/**
 * Instructors see their classes. Students can join a class; the list of their classes comes with EG-CLS-06.
 * Admins see a placeholder.
 */
export function Dashboard() {
  const me = useMe().data;
  if (!me) return null;
  if (me.role === 'INSTRUCTOR') return <ClassList />;

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-display font-semibold">Welcome, {me.firstName}</h1>
      {me.role === 'STUDENT' ? <JoinClass /> : <p className="text-muted">You are signed in as an admin.</p>}
    </div>
  );
}
