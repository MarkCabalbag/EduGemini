import type { Prisma } from '@prisma/client';

/**
 * Lock a submission's row until the transaction ends, so writes that change it run one at a time (API Spec A11). Finalize
 * takes it; approve, reopen and the grade write take it when they exist. This is the one place raw SQL is allowed
 * (code-standards §7), because Prisma has no `FOR UPDATE`.
 */
export async function lockSubmission(tx: Prisma.TransactionClient, submissionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
}
