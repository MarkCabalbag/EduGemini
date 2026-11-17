import { ApiRequestError } from '../../lib/api';
import { errorTextOf } from '../../lib/error-text';
import { Alert } from './Alert';
import { Button } from './Button';

/** What a failed data view shows: the reason in words, and a way to try again (UX Brief §9.6). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const suspended = error instanceof ApiRequestError && error.code === 'ACCOUNT_SUSPENDED'; // trying again cannot help
  return (
    <div className="space-y-4">
      <Alert>{errorTextOf(error)}</Alert>
      {!suspended && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
