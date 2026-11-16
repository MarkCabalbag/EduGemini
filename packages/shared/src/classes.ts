import { z } from 'zod';
import { EnrollmentStatusSchema } from './enums';
import { PageQuery } from './paging';
import { EnrollmentCountsSchema } from './people';
import { safeText } from './text';

export const ClassStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type ClassStatus = z.infer<typeof ClassStatusSchema>;

// A blank optional field is the same as no field: the service stores it as null.
const optionalText = (max: number) => safeText(max).optional();

/** Create class (API Spec CLS-02). Limits: `ClassCreate` in openapi.yaml. The attestation must be ticked (PRD FR-CLS-09). */
export const CreateClassSchema = z.object({
  name: safeText(120).min(1, 'Required'),
  description: optionalText(2000),
  section: optionalText(60),
  subject: optionalText(60),
  room: optionalText(60),
  attestation: z.object({
    confirmed: z.literal(true, { error: 'Confirm this to create the class' }),
  }),
});
export type CreateClass = z.infer<typeof CreateClassSchema>;

/**
 * Edit class details (API Spec CLS-04). Any of the five fields: one left out is unchanged, a blank optional one is cleared,
 * and the name cannot be blank. Anything else, such as the join code, is refused (`ClassUpdate` in openapi.yaml).
 */
export const UpdateClassSchema = z.strictObject({
  name: safeText(120).min(1, 'Required').optional(),
  description: optionalText(2000),
  section: optionalText(60),
  subject: optionalText(60),
  room: optionalText(60),
});
export type UpdateClass = z.infer<typeof UpdateClassSchema>;

/** The class id in the path of every `/classes/:classId` route. */
export const ClassParamsSchema = z.object({ classId: z.uuid() });

/** List classes (API Spec CLS-01). */
export const ListClassesQuerySchema = z.object({ status: ClassStatusSchema.default('ACTIVE'), ...PageQuery });
export type ListClassesQuery = z.infer<typeof ListClassesQuerySchema>;

/** Join by code (API Spec JOIN-01). The code is trimmed and uppercased, so entry is case-insensitive. */
const joinCode = z.string().trim().toUpperCase();
export const JoinSchema = z.object({ code: joinCode.length(8, 'Enter the 8-character code') });
export type Join = z.infer<typeof JoinSchema>;

/** The code in a join link (API Spec JOIN-02). A code of the wrong length is not a validation error: it is just a code that does not work. */
export const JoinLinkParamsSchema = z.object({ code: joinCode });

/** What a join link shows: no student data, no assignments, no counts. */
export const JoinPreviewSchema = z.object({
  className: z.string(),
  instructorFirstName: z.string(),
  requireApproval: z.boolean(),
});
export type JoinPreview = z.infer<typeof JoinPreviewSchema>;

export const JoinResultSchema = z.object({
  classId: z.uuid(),
  className: z.string(),
  status: EnrollmentStatusSchema,
});
export type JoinResult = z.infer<typeof JoinResultSchema>;

/** A class as the caller sees it (API Spec A5). The join fields and `counts` are for the owning instructor only; `instructorName` and `enrollment` for a student. */
export const ClassSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  section: z.string().nullable(),
  subject: z.string().nullable(),
  room: z.string().nullable(),
  status: ClassStatusSchema,
  joinCode: z.string().optional(),
  joinLink: z.string().optional(),
  joinCodeActive: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  counts: EnrollmentCountsSchema.optional(),
  instructorName: z.string().optional(),
  enrollment: z.object({ status: EnrollmentStatusSchema }).optional(),
});
export type ClassSummary = z.infer<typeof ClassSummarySchema>;

export const ClassPageSchema = z.object({
  items: z.array(ClassSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ClassPage = z.infer<typeof ClassPageSchema>;

/** A student's Enrolled list (API Spec JOIN-03). */
export const EnrolledQuerySchema = z.object(PageQuery);
export type EnrolledQuery = z.infer<typeof EnrolledQuerySchema>;

/** One class in the Enrolled list. Removed classes are not listed. `instructorName` is the first name and last initial. */
export const EnrollmentSummarySchema = z.object({
  classId: z.uuid(),
  className: z.string(),
  status: EnrollmentStatusSchema,
  instructorName: z.string(),
  archived: z.boolean(),
  joinedAt: z.iso.datetime(),
});
export type EnrollmentSummary = z.infer<typeof EnrollmentSummarySchema>;

export const EnrolledPageSchema = z.object({
  items: z.array(EnrollmentSummarySchema),
  nextCursor: z.string().nullable(),
});
export type EnrolledPage = z.infer<typeof EnrolledPageSchema>;
