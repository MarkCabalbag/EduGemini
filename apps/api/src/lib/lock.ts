import type { Prisma } from '@prisma/client';

// The row locks. This is the one place raw SQL is allowed (code-standards §7), because Prisma has no `FOR UPDATE`.

/**
 * Lock a submission's row until the transaction ends, so writes that change it run one at a time (API Spec A11). Finalize
 * takes it; approve, reopen and the grade write take it when they exist.
 */
export async function lockSubmission(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
}

/**
 * Lock an instructor's key row until the transaction ends (API Spec KEY-02, Concurrency). Before a first save there is no row to
 * lock; the unique index on `instructor_id` and the save's upsert keep two first saves apart.
 */
export async function lockInstructorKey(tx: Prisma.TransactionClient, instructorId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM instructor_keys WHERE instructor_id = ${instructorId}::uuid FOR UPDATE`;
}

/** The same for a class's row. Regenerating the code takes it (API Spec A11, CLS-08). */
export async function lockClass(tx: Prisma.TransactionClient, classId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId}::uuid FOR UPDATE`;
}
