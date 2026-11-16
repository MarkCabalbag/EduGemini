import { z } from 'zod';
import { AssignmentStatusSchema, ScoringFormatSchema } from './enums';
import { PageQuery } from './paging';
import { safeText } from './text';

/** True for an IANA zone name such as `Asia/Manila`. The runtime knows the zones, so no library is needed. */
const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** The writable fields of an assignment (API Spec A5, `AssignmentInput`; limits in openapi.yaml). */
const AssignmentFieldsSchema = z.object({
  title: safeText(200).min(1, 'Required'),
  instructions: safeText(5000),
  criteriaText: safeText(5000),
  dueAt: z.iso.datetime({ error: 'Enter a valid date and time' }),
  timezone: z.string().max(64).refine(isTimeZone, 'Choose a time zone from the list'),
  scoringFormat: ScoringFormatSchema,
  // The column holds two decimals, so anything below 0.01 would be stored as 0 and break its check.
  maxScore: z.number().min(0.01, 'Use a number from 0.01 to 1000').max(1000, 'Use a number from 0.01 to 1000'),
  maxResubmissions: z.number().int().min(0, 'Use 0 to 10, or Unlimited').max(10, 'Use 0 to 10, or Unlimited').nullable(),
  acceptLate: z.boolean(),
});

/** Create a draft (API Spec ASG-02). Only the title is required; the service fills the rest with defaults. */
export const CreateAssignmentSchema = AssignmentFieldsSchema.partial().required({ title: true });
export type CreateAssignment = z.infer<typeof CreateAssignmentSchema>;

/** Edit a draft (API Spec ASG-04): any of the fields. */
export const UpdateAssignmentSchema = AssignmentFieldsSchema.partial();
export type UpdateAssignment = z.infer<typeof UpdateAssignmentSchema>;

/** The wizard's Criteria step: a draft may hold empty criteria (API Spec B.6), but the step asks for them (App Flow §5.1). */
export const RequiredCriteriaSchema = z.object({ criteriaText: AssignmentFieldsSchema.shape.criteriaText.min(1, 'Add grading criteria') });

export const AssignmentParamsSchema = z.object({ assignmentId: z.uuid() });

/** List assignments (API Spec ASG-01). Without a status, every status is listed. */
export const ListAssignmentsQuerySchema = z.object({ status: AssignmentStatusSchema.optional(), ...PageQuery });
export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;

/** A row in a list (API Spec A5). `maxResubmissions` null means Unlimited. */
export const AssignmentSummarySchema = z.object({
  id: z.uuid(),
  classId: z.uuid(),
  title: z.string(),
  dueAt: z.iso.datetime(),
  timezone: z.string(),
  status: AssignmentStatusSchema,
  scoringFormat: ScoringFormatSchema,
  maxScore: z.number(),
  maxResubmissions: z.number().int().nullable(),
  acceptLate: z.boolean(),
  criteriaVersion: z.number().int(),
});
export type AssignmentSummary = z.infer<typeof AssignmentSummarySchema>;

export const AssignmentDetailSchema = AssignmentSummarySchema.extend({
  instructions: z.string().nullable(),
  criteriaText: z.string(),
});
export type AssignmentDetail = z.infer<typeof AssignmentDetailSchema>;

export const AssignmentPageSchema = z.object({
  items: z.array(AssignmentSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AssignmentPage = z.infer<typeof AssignmentPageSchema>;

/** What publishing warns about without blocking it (API Spec ASG-06, App Flow F16). */
export const PublishWarningSchema = z.enum(['DUE_IN_PAST', 'NO_VALID_KEY']);
export type PublishWarning = z.infer<typeof PublishWarningSchema>;

export const PublishedAssignmentSchema = AssignmentDetailSchema.extend({ warnings: z.array(PublishWarningSchema) });
export type PublishedAssignment = z.infer<typeof PublishedAssignmentSchema>;
