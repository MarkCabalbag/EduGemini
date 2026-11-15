import { z } from 'zod';
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

/** The class id in the path of every `/classes/:classId` route. */
export const ClassParamsSchema = z.object({ classId: z.uuid() });

/** List classes (API Spec CLS-01). The cursor is opaque to callers. `limit` is a plain whole number, 1 to 100, default 25 (API Spec A2). */
export const ListClassesQuerySchema = z.object({
  status: ClassStatusSchema.default('ACTIVE'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'Use a whole number from 1 to 100')
    .transform(Number)
    .pipe(z.number().min(1, 'Use a whole number from 1 to 100').max(100, 'Use a whole number from 1 to 100'))
    .default(25),
});
export type ListClassesQuery = z.infer<typeof ListClassesQuerySchema>;

/** A class as the caller sees it (API Spec A5). The join fields are for the owning instructor only. */
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
});
export type ClassSummary = z.infer<typeof ClassSummarySchema>;

export const ClassPageSchema = z.object({
  items: z.array(ClassSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ClassPage = z.infer<typeof ClassPageSchema>;
