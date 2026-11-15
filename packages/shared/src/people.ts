import { z } from 'zod';
import { EnrollmentStatusSchema } from './enums';
import { PageQuery } from './paging';

/** How many students are in each state. Always complete, whatever a list is filtered by (API Spec PPL-01). */
export const EnrollmentCountsSchema = z.object({
  approved: z.number().int().min(0),
  pending: z.number().int().min(0),
  declined: z.number().int().min(0),
  removed: z.number().int().min(0),
});
export type EnrollmentCounts = z.infer<typeof EnrollmentCountsSchema>;

/** Change join approval (API Spec CLS-10). */
export const ClassSettingsSchema = z.object({ requireApproval: z.boolean() });
export type ClassSettings = z.infer<typeof ClassSettingsSchema>;

/** `pendingCount` tells the page whether to offer "Approve all pending" after approval is turned off. */
export const ClassSettingsResultSchema = ClassSettingsSchema.extend({ pendingCount: z.number().int().min(0) });
export type ClassSettingsResult = z.infer<typeof ClassSettingsResultSchema>;

/** List people in a class (API Spec PPL-01). Without a status, every student is listed. */
export const PeopleQuerySchema = z.object({ status: EnrollmentStatusSchema.optional(), ...PageQuery });
export type PeopleQuery = z.infer<typeof PeopleQuerySchema>;

/** One student in a class, as the owning instructor sees them: name and email only (PRD §11). */
export const EnrollmentViewSchema = z.object({
  id: z.uuid(),
  student: z.object({ id: z.uuid(), displayName: z.string(), email: z.string() }),
  status: EnrollmentStatusSchema,
  joinedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type EnrollmentView = z.infer<typeof EnrollmentViewSchema>;

export const PeoplePageSchema = z.object({
  counts: EnrollmentCountsSchema,
  items: z.array(EnrollmentViewSchema),
  nextCursor: z.string().nullable(),
});
export type PeoplePage = z.infer<typeof PeoplePageSchema>;

/** Change an enrollment decision (API Spec PPL-02). */
export const DecisionSchema = z.object({ action: z.enum(['APPROVE', 'DECLINE', 'REVERSE', 'REMOVE']) });
export type Decision = z.infer<typeof DecisionSchema>;

export const EnrollmentParamsSchema = z.object({ enrollmentId: z.uuid() });

/** Approve all pending (API Spec PPL-03). */
export const ApproveAllResultSchema = z.object({ approvedCount: z.number().int().min(0) });
export type ApproveAllResult = z.infer<typeof ApproveAllResultSchema>;
