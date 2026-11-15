import { Link } from 'react-router';
import { buttonClass } from '../components/ui/Button';

export function NotFound() {
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-display font-semibold">We couldn&apos;t find that page.</h1>
      <Link to="/classes" className={buttonClass('secondary')}>
        Go to dashboard
      </Link>
    </div>
  );
}
