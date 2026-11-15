import { Link } from 'react-router';
import { buttonClass } from '../components/ui/Button';

const POINTS = [
  'AI-assisted first pass on every submission',
  'The instructor always decides the final grade',
  'Free to use with your own Gemini key',
];

export function Landing() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-display font-semibold">Get a first-pass grade on student work, and keep the final say.</h1>
      <ul className="list-disc space-y-1 pl-6">
        {POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link to="/signup" className={buttonClass('primary')}>
          Sign up
        </Link>
        <Link to="/signin" className={buttonClass('secondary')}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
