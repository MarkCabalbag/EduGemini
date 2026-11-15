import { useMe } from '../hooks/use-auth';

const ROLE_TEXT = { INSTRUCTOR: 'an instructor', STUDENT: 'a student', SUPER_ADMIN: 'an admin' } as const;

/** A placeholder until the class tickets (EG-CLS-*) add the real dashboard. */
export function Dashboard() {
  const me = useMe().data;
  if (!me) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-display font-semibold">Welcome, {me.firstName}</h1>
      <p className="text-muted">You are signed in as {ROLE_TEXT[me.role]}. Your classes will appear here.</p>
    </div>
  );
}
