import { z } from 'zod';

// Values match the Prisma enums exactly (Backend Schema §5). A test keeps them in step.

export const RoleSchema = z.enum(['STUDENT', 'INSTRUCTOR', 'SUPER_ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const EnrollmentStatusSchema = z.enum(['PENDING', 'ACTIVE', 'DECLINED', 'REMOVED']);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

export const AssignmentStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

export const ScoringFormatSchema = z.enum(['POINTS', 'PERCENTAGE', 'LETTER_NUMERIC']);
export type ScoringFormat = z.infer<typeof ScoringFormatSchema>;

export const VersionStatusSchema = z.enum(['UPLOADING', 'STORED', 'REPLACED']);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const FileStatusSchema = z.enum(['STORED', 'FAILED']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const NotificationTypeSchema = z.enum([
  'SUBMISSION_GRADED',
  'GRADE_APPROVED',
  'SUBMISSION_AWAITING_REVIEW',
  'NEEDS_MANUAL_REVIEW_INSTRUCTOR',
  'NEEDS_MANUAL_REVIEW_STUDENT',
  'KEY_NEEDS_ATTENTION',
  'REGRADE_COMPLETE',
  'SUBMISSION_REOPENED',
  'JOIN_REQUEST_RECEIVED',
  'JOIN_DECIDED',
  'ATTEMPTS_GRANTED',
  'LATE_ALLOWED',
  'ASSIGNMENT_PUBLISHED',
  'DUE_DATE_CHANGED',
  'CLASS_DELETED',
  'INSTRUCTOR_ACCOUNT_DELETED',
  'ACCOUNT_STATUS_CHANGED',
  'RETENTION_NOTICE',
  'ANNOUNCEMENT_POSTED',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
