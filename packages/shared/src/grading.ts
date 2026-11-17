import { z } from 'zod';

/** Why a grading job was started (TRD §10.1). Only `first` and `resubmit` are sent so far; the others come with their tickets. */
export const GradeModeSchema = z.enum(['first', 'resubmit', 'regrade_criteria', 'rerun', 'regrade_approved']);
export type GradeMode = z.infer<typeof GradeModeSchema>;

/** The payload of a `grade.submission` job (TRD §10.1). */
export const GradeJobSchema = z.object({
  submissionId: z.uuid(),
  versionId: z.uuid(),
  mode: GradeModeSchema,
});
export type GradeJob = z.infer<typeof GradeJobSchema>;

/**
 * What Gemini must answer (API Spec C.1, `GradeOutput`). The score's range depends on the assignment, so the pipeline checks
 * it against the maximum after this parse (TRD §10.6). The model's own letter, if it sends one, is not read.
 */
export const GradeOutputSchema = z.object({
  score: z.number().finite(),
  feedback: z.string().trim().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  readabilityIssue: z.boolean(),
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;
