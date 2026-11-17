import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { PageLoading } from '../components/ui/Skeleton';
import { useMe } from '../hooks/use-auth';
import { useJoinClass, useJoinPreview } from '../hooks/use-classes';
import { ApiRequestError } from '../lib/api';
import { errorText, errorTextOf } from '../lib/error-text';
import { joinedText } from './JoinClass';

/**
 * The page a join link opens (App Flow §6 step 1, UX Brief §9.1). Signed-out visitors sign up or sign in and come back here,
 * with the code still in the address. A student who has just signed in is joined at once (App Flow F2); one who was
 * already signed in presses Join class, so opening a link never joins anyone by itself.
 */
export function JoinLink() {
  const code = useParams<'code'>().code!.trim().toUpperCase(); // the route has :code; one form of it for the cache and the request
  const location = useLocation();
  const navigate = useNavigate();
  const meQuery = useMe();
  const me = meQuery.data; // null when signed out
  const preview = useJoinPreview(code);
  const join = useJoinClass();

  const isStudent = me?.role === 'STUDENT';
  const justSignedIn = (location.state as { afterSignIn?: boolean } | null)?.afterSignIn === true;
  const { mutate } = join;
  useEffect(() => {
    if (!justSignedIn || !isStudent || !preview.isSuccess) return;
    mutate({ code });
    // Use the flag up: it sits in the history entry, so without this, Back or a reload would join again.
    void navigate(location.pathname, { replace: true, state: null });
  }, [justSignedIn, isStudent, preview.isSuccess, mutate, navigate, location.pathname, code]);

  if (preview.isPending || meQuery.isPending) return <PageLoading />;
  if (preview.isError) {
    const error = preview.error;
    // These two are answers, not failures, so there is nothing to retry.
    if (error instanceof ApiRequestError && (error.code === 'INVALID_JOIN_CODE' || error.code === 'INSTRUCTOR_CANNOT_JOIN')) {
      return (
        <div className="max-w-md space-y-4">
          <Alert>{errorText(error.code)}</Alert>
          <Link to="/" className="font-semibold text-primary underline">
            Go to EduGemini
          </Link>
        </div>
      );
    }
    return <ErrorState error={error} onRetry={() => void preview.refetch()} />;
  }

  const { className, instructorFirstName } = preview.data;
  // Where sign-up and sign-in send the visitor back to.
  const signInState = { from: location.pathname };

  return (
    <div className="max-w-md space-y-6">
      <div className="space-y-2">
        <title>{`Join ${className} · EduGemini`}</title>
        <h1 className="text-display font-semibold">{className}</h1>
        <p className="text-muted">Taught by {instructorFirstName}</p>
      </div>
      {join.isError && <Alert>{errorTextOf(join.error)}</Alert>}
      {join.data && <Alert variant="info">{joinedText(join.data)}</Alert>}

      {!me && (
        <div className="space-y-4">
          <Link to="/signup" state={signInState} className={buttonClass()}>
            Sign up to join
          </Link>
          <p>
            Already have an account?{' '}
            <Link to="/signin" state={signInState} className="font-semibold text-primary underline">
              Sign in
            </Link>
          </p>
        </div>
      )}
      {me && !isStudent && <Alert variant="info">Only student accounts can join classes.</Alert>}
      {isStudent && !join.data && (
        <Button loading={join.isPending} onClick={() => mutate({ code })}>
          Join class
        </Button>
      )}
      {join.data && (
        <Link to="/classes" className="font-semibold text-primary underline">
          Go to my dashboard
        </Link>
      )}
    </div>
  );
}
