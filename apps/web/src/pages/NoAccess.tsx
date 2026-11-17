import { Link } from 'react-router';
import { buttonClass } from '../components/ui/Button';

/** The page of another role, such as a student opening an instructor address (App Flow, access rules; UX Brief §9.6). It never says whether the item exists. */
export function NoAccess() {
  return (
    <div className="max-w-md space-y-4">
      <title>No access · EduGemini</title>
      <h1 className="text-display font-semibold">You don&apos;t have access to this page.</h1>
      <Link to="/classes" className={buttonClass('secondary')}>
        Go to dashboard
      </Link>
    </div>
  );
}
