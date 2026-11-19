import type { ReactNode } from 'react';
import { Link } from 'react-router';

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h3>{title}</h3>
      <ul>{children}</ul>
    </nav>
  );
}

/**
 * The footer of the public pages (the front page, Terms and Privacy), on the Marked Script paper: the brand and what the
 * product promises, where to start, and the legal pages. Put it inside an element with the `lp` class (index.css).
 * The front page also lists its own sections and repeats the Gemini notice.
 */
export function SiteFooter({ onFrontPage = false }: { onFrontPage?: boolean }) {
  return (
    <footer className="lp-foot">
      <div className={`lp-foot-cols ${onFrontPage ? '' : 'lp-foot-3'}`}>
        <div>
          <Link to="/" className="lp-logo">
            <span aria-hidden className="lp-mark">
              <svg viewBox="0 0 34 34" fill="none" stroke="var(--margin-red)" strokeWidth="2.5">
                <path strokeLinecap="round" d="M9 6 C20 0 33 8 31 19 C29 30 13 34 5 25 C0 19 3 9 13 5" />
              </svg>
              E
            </span>
            EduGemini
          </Link>
          <p className="lp-muted">First-pass grading in minutes, with the instructor always in control.</p>
        </div>
        <FooterColumn title="Get started">
          <li>
            <Link to="/signup">Sign up</Link>
          </li>
          <li>
            <Link to="/signin">Sign in</Link>
          </li>
        </FooterColumn>
        {onFrontPage && (
          <FooterColumn title="On this page">
            <li>
              <a href="#how">How it works</a>
            </li>
            <li>
              <a href="#data">Where work goes</a>
            </li>
          </FooterColumn>
        )}
        <FooterColumn title="Legal">
          <li>
            <Link to="/terms">Terms of Use</Link>
          </li>
          <li>
            <Link to="/privacy">Privacy Notice</Link>
          </li>
        </FooterColumn>
      </div>
      {onFrontPage && <p className="lp-disc">Student work is processed by Google Gemini and reviewed by the instructor.</p>}
      <p className="lp-legal">&copy; 2026 EduGemini</p>
    </footer>
  );
}
