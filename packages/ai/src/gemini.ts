import type { ScoringFormat } from '@edugemini/shared';

/** One file the student handed in, as the adapter sees it. */
export type GradeFile = {
  mimeType: string;
  data: Buffer;
  /** For the fake adapter only, which reads its scenario from the name. The live adapter never sends a file name (TRD §10.4). */
  displayName: string;
};

/** What a grading call is given: the assignment and the student's files in order. Never a name, an ID or an email (TRD §10.4). */
export type GradeInput = {
  assignment: { title: string; instructions: string | null; criteriaText: string; scoringFormat: ScoringFormat; maxScore: number };
  studentFiles: GradeFile[];
};

/**
 * Why a Gemini call failed, in the classes the pipeline acts on (TRD §10.7). Transient errors are retried; the other three
 * are about the instructor's key and are not.
 */
export type GeminiErrorKind = 'TRANSIENT' | 'KEY_INVALID' | 'KEY_API_DISABLED' | 'QUOTA';

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** The one place the app talks to Gemini. `GEMINI_MODE` picks the fake or the live one (TRD §11, API Spec C.1). */
export type GeminiAdapter = {
  /** The model that answers, stored with every result (PRD §9.6). */
  readonly model: string;
  /**
   * Grade one submission with the instructor's key. The answer is the model's JSON text, not a parsed result: the caller
   * parses it and checks the score, so a malformed answer is handled in one place (TRD §10.3 step 5). Throws `GeminiError`.
   */
  grade(input: GradeInput, apiKey: string, options?: { signal?: AbortSignal }): Promise<string>;
};
