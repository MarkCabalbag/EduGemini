/** File and grading limits. The client pre-check, the API and the tests all import these (TRD §9.2). */
export const MiB = 1024 * 1024;

export const LIMITS = {
  filesPerSubmission: 10,
  maxFileBytes: 10 * MiB,
  maxPdfPages: 20,
  maxSubmissionBytes: 15 * MiB,
  maxReferenceFiles: 3,
  /** Raw bytes sent to Gemini per call, reference files included (TRD §11.3). */
  gradingInputBytes: 15 * MiB,
} as const;
