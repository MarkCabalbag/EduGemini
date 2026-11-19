import { useMe } from '../hooks/use-auth';
import { usePaperPage } from '../hooks/use-paper-page';
import { PAPER_HEADING } from '../lib/paper';
import { ClassList } from './ClassList';
import { Enrolled } from './Enrolled';
import { JoinClass } from './JoinClass';

/**
 * Instructors see their classes. Students can join a class and see the classes they are in.
 * Admins see a placeholder. The page is on the Marked Script paper (index.css, .paper-page).
 */
export function Dashboard() {
  usePaperPage();
  const me = useMe().data;
  if (!me) return null;
  if (me.role === 'INSTRUCTOR') return <ClassList />;

  return (
    <div className="space-y-[72px] pl-6 leading-9 sm:pl-12">
      <title>{me.role === 'STUDENT' ? 'My classes · EduGemini' : 'EduGemini'}</title>
      <div className="space-y-[18px]">
        <h1 className={PAPER_HEADING}>Welcome, {me.firstName}</h1>
        {me.role === 'STUDENT' ? (
          <div className="max-w-[32.5rem]">
            <JoinClass />
          </div>
        ) : (
          <p className="text-muted">You are signed in as an admin.</p>
        )}
      </div>
      {me.role === 'STUDENT' && <Enrolled />}
    </div>
  );
}
