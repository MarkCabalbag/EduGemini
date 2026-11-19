import { z } from 'zod';
import { FileStatusSchema, ScoringFormatSchema, VersionStatusSchema } from './enums';
import { safeText } from './text';

// Uploading a submission (API Spec A7, SUB-01 to SUB-03 and SUB-05). The file bytes are not JSON, so only the paths and the views are here.

export const VersionParamsSchema = z.object({ versionId: z.uuid() });

/** The browser makes `clientFileId`, so sending the same file again replaces it instead of adding a second one. */
export const FileParamsSchema = VersionParamsSchema.extend({ clientFileId: safeText(64).min(8) });

export const VersionViewSchema = z.object({
  id: z.uuid(),
  versionNo: z.number().int(),
  status: VersionStatusSchema,
  createdAt: z.iso.datetime(),
  storedAt: z.iso.datetime().nullable(),
});
export type VersionView = z.infer<typeof VersionViewSchema>;

export const FileViewSchema = z.object({
  id: z.uuid(),
  /** The browser's key for the file: how it is addressed to remove it and to list it at finalize. */
  clientFileId: z.string(),
  ordinal: z.number().int().min(1),
  displayName: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  status: FileStatusSchema,
  /** TYPE, SIZE, PAGES, PASSWORD or CORRUPT on a FAILED file (Backend Schema §4.14); the database holds the list. */
  failureCode: z.string().nullable(),
});
export type FileView = z.infer<typeof FileViewSchema>;

/** An upload that is open, with the files stored in it so far, so the page can pick it up after a reload. */
export const DraftVersionSchema = VersionViewSchema.extend({ files: z.array(FileViewSchema) });
export type DraftVersion = z.infer<typeof DraftVersionSchema>;

/** Finalize (API Spec SUB-05): the files the student saw, by their `clientFileId`. The list is the final set. */
export const FinalizeSchema = z.object({ expectedFileIds: z.array(safeText(64).min(8)).min(1).max(10) });
export type Finalize = z.infer<typeof FinalizeSchema>;

/** What a student sees of their submission (API Spec A5). Causes and internal states never appear here. */
export const DisplayStateSchema = z.enum([
  'NOT_SUBMITTED',
  'UPLOADING',
  'GRADING',
  'AWAITING_REVIEW',
  'AI_GENERATED',
  'INSTRUCTOR_APPROVED',
]);
export type DisplayState = z.infer<typeof DisplayStateSchema>;

/**
 * The grade a student sees (API Spec A5). `percentage` is the score as a whole-number percent of `maxScore`. `letter` is
 * null until the letter scale exists (AI-05, ASG-06). `chip` names the status token for the chip.
 */
export const GradeViewSchema = z.object({
  source: z.enum(['AI', 'INSTRUCTOR']),
  score: z.number(),
  maxScore: z.number(),
  scoringFormat: ScoringFormatSchema,
  letter: z.string().nullable(),
  percentage: z.number().int(),
  feedback: z.string(),
  chip: z.enum(['status-ai', 'status-approved']),
});
export type GradeView = z.infer<typeof GradeViewSchema>;

/** The student's own submission (API Spec SUB-01). */
export const StudentSubmissionSchema = z.object({
  state: DisplayStateSchema,
  isLate: z.boolean(),
  closed: z.boolean(),
  /** Null when the assignment allows unlimited resubmissions. */
  attemptsLeft: z.number().int().nullable(),
  unlimited: z.boolean(),
  firstSubmittedAt: z.iso.datetime().nullable(),
  latestSubmittedAt: z.iso.datetime().nullable(),
  /** The files of the current stored version, in order. Empty before the first submit. */
  files: z.array(FileViewSchema),
  /** The result, shown only while the state is `AI_GENERATED` or `INSTRUCTOR_APPROVED`. */
  grade: GradeViewSchema.nullable(),
  /** The instructor's comment, shown only once the grade is approved. */
  instructorComment: z.string().nullable(),
  /** An upload that is open now, if any. */
  draftVersion: DraftVersionSchema.nullable(),
});
export type StudentSubmission = z.infer<typeof StudentSubmissionSchema>;
