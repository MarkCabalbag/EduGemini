import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TERMS_VERSION } from '@edugemini/shared';
import { SiteFooter } from '../components/SiteFooter';
import { usePaperPage } from '../hooks/use-paper-page';

type Clause = { title: string; body: ReactNode };

/** The sentence that matters most about Google's free tier, underlined in the teacher's red. */
const GOOGLE_USES = <span className="lp-under">Google may use that content to improve its products.</span>;

const TERMS_SHORT = [
  'EduGemini is a classroom tool: Gemini marks first, the instructor decides.',
  'Submit only your own work, and keep your password to yourself.',
  'An AI result can be wrong, and it is not final until the instructor approves it.',
];

const TERMS_CLAUSES: Clause[] = [
  {
    title: 'What EduGemini is',
    body: 'EduGemini helps instructors grade student work. An instructor creates a class and assignments, students join and submit files, and Google Gemini produces a first-pass score and feedback. The instructor reviews the result and decides the final grade.',
  },
  {
    title: 'Accounts',
    body: 'You sign up as an instructor or as a student and accept these Terms when you do. Give a real name and email address, keep your password to yourself, and tell your instructor or the project owner if you think someone else has used your account. You are responsible for what happens under your account.',
  },
  {
    title: 'Instructors',
    body: 'Grading runs on your own Gemini API key, so the key, its limits and any cost are yours. Check Google’s current terms before you save a key. Tell your students that their work is processed by Google Gemini. You decide every final grade, and you can change the AI’s score and feedback before you approve it.',
  },
  {
    title: 'Students',
    body: 'Submit only your own work, or work you have the right to share. Files must be PDF, JPEG or PNG and stay inside the limits shown on the upload page. You can resubmit as many times as the instructor allows.',
  },
  {
    title: 'AI-generated results',
    body: 'A first-pass score and its feedback are written by an AI model. They can be wrong. Until the instructor approves them they are labeled AI-generated, and they are not a final grade. Questions about a grade go to your instructor.',
  },
  {
    title: 'Your work and your files',
    body: 'Your files and results stay yours. By submitting them you let EduGemini store them and send them to Google Gemini for grading, and nothing else. See the Privacy Notice for how they are handled.',
  },
  {
    title: 'Using EduGemini fairly',
    body: 'Do not upload anything unlawful or harmful, anyone else’s work without permission, or files meant to break the service. Do not try to get into classes, accounts or files you are not allowed to see, or get around the limits on uploads and sign-in attempts.',
  },
  {
    title: 'Suspending and deleting accounts',
    body: 'An administrator can suspend an account that breaks these Terms, and a suspended account cannot sign in. You can delete your own account in Settings at any time.',
  },
  {
    title: 'No guarantees',
    body: 'EduGemini is a portfolio project, provided as it is. It can be unavailable, and AI results can be wrong. To the extent the law allows, its owner is not liable for losses that come from using it.',
  },
  {
    title: 'Changes to these Terms',
    body: 'These Terms can change. Each version has a number, and the version you accepted is recorded when you sign up.',
  },
];

const PRIVACY_SHORT = [
  'Student files are sent to Google Gemini for a first-pass grade.',
  'The instructor of the class can see them, and so can you, for your own.',
  'You can delete your account and your files at any time.',
];

const PRIVACY_CLAUSES: Clause[] = [
  {
    title: 'What EduGemini keeps',
    body: 'Your name, email address and role; your password, which is stored only as a one-way hash; the classes you create or join; for students, the files you submit and the scores and feedback on them; and your notifications. An instructor’s Gemini API key is stored encrypted.',
  },
  {
    title: 'What it is used for',
    body: 'Only to run the service: signing you in, showing a class to its members, grading submissions, showing results, and sending you notifications about your classes.',
  },
  {
    title: 'Google Gemini',
    body: (
      <>
        The files a student submits are sent to Google Gemini, with the instructor’s own key, to produce a first-pass score and feedback.
        EduGemini asks Gemini not to keep them on its side. {GOOGLE_USES} Instructors are asked to check Google’s current terms before they
        save a key.
      </>
    ),
  },
  {
    title: 'Who can see your work',
    body: 'The instructor of a class sees the files, scores and feedback of the students in that class. A student sees their own. Administrators manage accounts and see account details only, not student files. Nobody else can open a file: files sit in private storage and open only through short-lived links for people who are allowed to see them.',
  },
  {
    title: 'Cookies',
    body: 'EduGemini sets one cookie, to keep you signed in. Signing out removes it, and it expires after 7 days of no use or 30 days at most.',
  },
  {
    title: 'How long it is kept',
    body: 'Files and results are kept until you delete them, or for 12 months after the class is archived. The instructor is told 30 days before an archived class is deleted. Uploads that were never submitted are removed after 24 hours.',
  },
  {
    title: 'Deleting your account',
    body: 'Delete your account in Settings and your personal data and your files are deleted. A gradebook keeps an anonymous “Deleted student” row with the score and status only. When an instructor deletes their account, their key is deleted too, their classes are archived and later deleted, and their students are told.',
  },
];

type Props = { title: string; short: string[]; clauses: Clause[]; other: { lead: string; to: string; name: string } };

/**
 * A legal page on the Marked Script paper: the title, a red Draft stamp with the version, a handwritten summary and the
 * clauses, each with its number circled on the red margin line like the front page. The wording is a plain-language draft
 * for a portfolio project; the version line stays until the owner has approved the final text (EG-DEMO-05).
 */
function LegalPage({ title, short, clauses, other }: Props) {
  usePaperPage();
  return (
    <div className="lp pl-6 sm:pl-12">
      <title>{`${title} · EduGemini`}</title>
      <div className="lp-doc">
        <h1>{title}</h1>
        <div className="lp-version">
          <span className="lp-stamp">Draft</span>
          <p>Version {TERMS_VERSION}. The final wording is still to be written and approved (EG-DEMO-05).</p>
        </div>
        <section className="lp-short" aria-label="In short">
          <h2>In short</h2>
          <ul>
            {short.map((line) => (
              <li key={line}>
                <Check aria-hidden size={22} strokeWidth={3} />
                {line}
              </li>
            ))}
          </ul>
        </section>
        {clauses.map((clause, i) => (
          <section key={clause.title} className="lp-clause">
            <span className="lp-n" aria-hidden>
              {i + 1}
            </span>
            <h2>{clause.title}</h2>
            <p>{clause.body}</p>
          </section>
        ))}
        <p className="lp-other">
          {other.lead} <Link to={other.to}>{other.name}</Link>
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

export function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      short={TERMS_SHORT}
      clauses={TERMS_CLAUSES}
      other={{ lead: 'What happens to the files students send:', to: '/privacy', name: 'Privacy Notice' }}
    />
  );
}

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Notice"
      short={PRIVACY_SHORT}
      clauses={PRIVACY_CLAUSES}
      other={{ lead: 'The rules for using EduGemini:', to: '/terms', name: 'Terms of Use' }}
    />
  );
}
