import { ApiRequestError } from '../../lib/api';
import { errorText } from '../../lib/error-text';
import { Alert } from './Alert';
import { Button } from './Button';

/** What a failed data view shows: the reason in words, and a way to try again (UX Brief §9.6). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL';
  return (
    <div className="space-y-4">
      <Alert>{errorText(code)}</Alert>
      {code !== 'ACCOUNT_SUSPENDED' && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
