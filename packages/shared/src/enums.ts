import { z } from 'zod';

// Values match the Prisma enums exactly (Backend Schema §5). A test keeps them in step.

export const RoleSchema = z.enum(['STUDENT', 'INSTRUCTOR', 'SUPER_ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const EnrollmentStatusSchema = z.enum(['PENDING', 'ACTIVE', 'DECLINED', 'REMOVED']);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;
