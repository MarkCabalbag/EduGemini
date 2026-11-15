import type { ReactNode } from 'react';
import { TERMS_VERSION } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-display font-semibold">{title}</h1>
      <Alert variant="info">
        Draft text (version {TERMS_VERSION}). The final wording is still to be written and approved (EG-DEMO-05).
      </Alert>
      {children}
    </div>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        EduGemini helps instructors grade student work. Submissions are processed by Google Gemini using the instructor&apos;s
        own API key, and every grade is reviewed by the instructor before it is final.
      </p>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Notice">
      <p>
        Files a student submits are sent to Google Gemini to produce a first-pass score and feedback, and are visible to the
        instructor of the class. Students can delete their account and files at any time.
      </p>
    </LegalPage>
  );
}
