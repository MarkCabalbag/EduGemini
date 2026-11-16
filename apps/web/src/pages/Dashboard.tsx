import { useMe } from '../hooks/use-auth';
import { ClassList } from './ClassList';
import { Enrolled } from './Enrolled';
import { JoinClass } from './JoinClass';

/**
 * Instructors see their classes. Students can join a class and see the classes they are in.
 * Admins see a placeholder.
 */
export function Dashboard() {
  const me = useMe().data;
  if (!me) return null;
  if (me.role === 'INSTRUCTOR') return <ClassList />;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-semibold">Welcome, {me.firstName}</h1>
      {me.role === 'STUDENT' ? (
        <>
          <div className="max-w-md">
            <JoinClass />
          </div>
          <Enrolled />
        </>
      ) : (
        <p className="text-muted">You are signed in as an admin.</p>
      )}
    </div>
  );
}
