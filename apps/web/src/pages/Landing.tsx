import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { SiteFooter } from '../components/SiteFooter';
import { buttonClass } from '../components/ui/Button';
import { usePaperPage } from '../hooks/use-paper-page';

const POINTS = [
  'AI-assisted first pass on every submission',
  'The instructor always decides the final grade',
  'Free to use with your own Gemini key',
];

const SCORE_CIRCLE = 'M40 34 C120 6 286 14 314 86 C330 150 236 188 150 184 C60 180 4 150 6 100 C8 60 36 38 84 24';
const RULES = Array.from({ length: 13 }, (_, i) => 70 + i * 36);
const ANSWER = [
  'The seed coat protects the embryo',
  'until it is time to grow. Water gets',
  'in first, then the root grows down',
  'and the shoot grows up toward the',
  'light.',
];

/** A pen stroke that draws itself; `delay` staggers the marks like a teacher working down the page. */
function Pen({ d, width, delay }: { d: string; width: number; delay: number }) {
  const style: CSSProperties = { animationDelay: `${delay}s` };
  return <path className="pen-stroke" pathLength={1} d={d} strokeWidth={width} style={style} />;
}

/** One sample answer, marked: the AI's first score struck through, the instructor's score circled, a note. All in one SVG so every mark stays on its words. */
function MarkedScript() {
  return (
    <svg
      className="lp-script"
      viewBox="0 0 440 520"
      role="img"
      aria-label="A sample student answer, marked. The AI's first pass of 38 out of 50 is crossed out. The instructor's score of 42 out of 50 is circled, with the note: Approved. Method is clear. Add the numbers to your conclusion."
    >
      <rect x=".5" y=".5" width="439" height="519" fill="var(--paper)" stroke="var(--primary)" />
      {RULES.map((y) => (
        <line key={y} x1="1" x2="439" y1={y} y2={y} stroke="var(--rule)" />
      ))}
      <line x1="56" y1="1" x2="56" y2="519" stroke="var(--margin-red)" strokeWidth="2" />
      <text x="72" y="64" fontWeight="700" fontSize="15" fill="var(--primary)">
        Lab report 1 · Sam T.
      </text>
      <text x="250" y="64" className="font-hand" fontSize="24" fill="var(--text-muted)">
        AI: 38 / 50
      </text>
      {ANSWER.map((text, i) => (
        <text
          key={text}
          x="72"
          y={172 + i * 36}
          className="font-hand"
          fontSize="26"
          fill="var(--text)"
          textLength={i === 4 ? 52 : 336}
          lengthAdjust="spacingAndGlyphs"
        >
          {text}
        </text>
      ))}
      <g fill="none" stroke="var(--margin-red)" strokeLinecap="round" strokeLinejoin="round">
        <Pen d="M246 54 L338 56" width={3} delay={1.4} />
        <Pen d="M306 216 C330 211 362 218 410 212" width={3} delay={0.5} />
        <Pen d="M344 164 C348 144 410 142 416 163 C420 184 352 188 345 170" width={3} delay={0.9} />
        <g transform="translate(286 62) scale(.4)">
          <Pen d={SCORE_CIRCLE} width={7} delay={1.8} />
          <text
            x="166"
            y="138"
            textAnchor="middle"
            transform="rotate(-5 166 104)"
            className="font-hand"
            fontSize="112"
            fill="var(--margin-red)"
            stroke="none"
          >
            42/50
          </text>
        </g>
        <Pen d="M392 366 L406 382 L436 344" width={4} delay={2.3} />
      </g>
      <g className="lp-note font-hand" fontSize="26" fill="var(--margin-red)">
        <text x="72" y="388">
          Approved. Method is clear.
        </text>
        <text x="72" y="424">
          Add the numbers to your
        </text>
        <text x="72" y="460">
          conclusion.
        </text>
      </g>
      <text x="72" y="496" fontSize="13" fill="var(--text-muted)">
        A sample answer, not a real student&apos;s work.
      </text>
    </svg>
  );
}

/** The circled score, as it looks on the student's result. */
function ScoreCircle() {
  return (
    <svg viewBox="0 0 340 232" width="105" height="72" aria-label="42 out of 50" role="img" className="block">
      <g fill="none" stroke="var(--margin-red)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d={SCORE_CIRCLE} />
      </g>
      <text
        x="166"
        y="138"
        textAnchor="middle"
        transform="rotate(-5 166 104)"
        className="font-hand"
        fontSize="112"
        fill="var(--margin-red)"
      >
        42/50
      </text>
    </svg>
  );
}

function CtaButtons() {
  return (
    <div className="lp-cta">
      <Link to="/signup" className={`${buttonClass('primary')} lp-btn`}>
        Sign up
      </Link>
      <Link to="/signin" className={`${buttonClass('secondary')} lp-btn`}>
        Sign in
      </Link>
    </div>
  );
}

/** One stage of a submission's life: its number is circled on the red margin line, and its artifact is the real screen. */
function Stage({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <div className="lp-stage">
      <span className="lp-n" aria-hidden>
        {n}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div className="lp-art">{children}</div>
    </div>
  );
}

/** The front page (UX Brief §3), on the Marked Script paper: the page is an exam script being marked. */
export function Landing() {
  usePaperPage();
  return (
    <div className="lp pl-6 sm:pl-12">
      <div className="lp-hero">
        <div>
          <h1>
            Get a first-pass grade on student work, and keep <span className="lp-final">the final say.</span>
          </h1>
          <ul className="lp-ticks">
            {POINTS.map((point) => (
              <li key={point}>
                <Check aria-hidden size={22} strokeWidth={3} />
                {point}
              </li>
            ))}
          </ul>
          <CtaButtons />
        </div>
        <MarkedScript />
      </div>

      <section className="lp-section" id="how" aria-labelledby="how-title">
        <h2 id="how-title">The life of one submission</h2>
        <p>Four screens, from the first class to the grade a student can trust.</p>
        <Stage
          n={1}
          title="The instructor sets up"
          text="Create a class and an assignment. Write the grading criteria in plain language, and share the class code."
        >
          <span className="lp-lbl">Grading criteria</span>
          <div className="lp-box">
            Hypothesis is stated clearly (10 points).
            <br />
            Method can be repeated (20 points).
            <br />
            Conclusion follows from the data (20 points).
          </div>
          <span className="lp-lbl mt-9">Class code</span>
          <div className="lp-code">
            <div className="lp-code-boxes" role="img" aria-label="Class code K7PM4QXR">
              {'K7PM4QXR'.split('').map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            <span className="lp-fake-btn">Copy</span>
          </div>
        </Stage>
        <Stage n={2} title="Students submit" text="Students join with the class code and upload PDFs or photos of their work.">
          <span className="lp-lbl">Your files</span>
          <p>
            <b>Lab report.pdf</b> <span className="lp-muted">62 KB</span>
          </p>
          <span className="lp-chip lp-red">
            <Check aria-hidden size={22} strokeWidth={3} />
            Uploaded
          </span>
          <span className="lp-fake-btn lp-fake-primary mt-[18px]">Submit files</span>
        </Stage>
        <Stage
          n={3}
          title="Gemini marks first"
          text="With the instructor's own key, Gemini grades against the criteria and writes feedback. The student sees it labeled AI-generated."
        >
          <span className="lp-chip lp-pencil">AI-generated</span>
          <span className="lp-lbl">Score</span>
          <p className="lp-score">38 / 50</p>
          <span className="lp-lbl">Feedback</span>
          <p>The method is clear. The conclusion needs the data.</p>
          <p className="lp-small">Scores and feedback are AI-generated and reviewed by your instructor.</p>
        </Stage>
        <Stage
          n={4}
          title="The instructor decides"
          text="The instructor reviews, changes what they want and approves. Only then is the grade final."
        >
          <span className="lp-chip lp-red">
            <Check aria-hidden size={22} strokeWidth={3} />
            Instructor-approved
          </span>
          <span className="lp-lbl">Score</span>
          <ScoreCircle />
          <span className="lp-lbl">Instructor comment</span>
          <p>Add the numbers to your conclusion.</p>
        </Stage>
      </section>

      <section className="lp-section" id="data" aria-labelledby="data-title">
        <h2 id="data-title">Where student work goes</h2>
        <div className="lp-who">
          <div>
            <h3>The files</h3>
            <p>Student work is sent to Google Gemini under the instructor&apos;s own key.</p>
          </div>
          <div>
            <h3>Google&apos;s free tier</h3>
            <p>
              <span className="lp-under">Google may use that content to improve its products.</span> Instructors are asked to check
              Google&apos;s current terms before they save a key.
            </p>
          </div>
          <div>
            <h3>The result</h3>
            <p>Every AI result is labeled AI-generated until the instructor approves it.</p>
          </div>
        </div>
      </section>

      <section className="lp-close">
        <h2>
          Create an account to set up your <span className="lp-final lp-final-sm">first class.</span>
        </h2>
        <CtaButtons />
      </section>

      <SiteFooter onFrontPage />
    </div>
  );
}
