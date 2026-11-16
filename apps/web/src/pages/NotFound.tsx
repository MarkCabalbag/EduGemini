import { Link, useLocation } from 'react-router';
import { buttonClass } from '../components/ui/Button';

/** A page that is not there, or not the caller's. Reached from a notification, it says the item is gone (App Flow §10). */
export function NotFound() {
  const { state } = useLocation();
  const fromNotification = state?.fromNotification === true;

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-display font-semibold">
        {fromNotification ? 'This item is no longer available.' : "We couldn't find that page."}
      </h1>
      <Link to="/classes" className={buttonClass('secondary')}>
        Go to dashboard
      </Link>
    </div>
  );
}
