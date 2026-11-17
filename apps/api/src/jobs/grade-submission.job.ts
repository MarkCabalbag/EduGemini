import type { Job, PgBoss } from 'pg-boss';
import { GradeJobSchema, type GradeJob } from '@edugemini/shared';
import type { Logger } from '../lib/logger';
import { gradeSubmission, type EnqueueGrading, type GradingDeps } from '../services/grading-service';

/** Grades one submission (TRD §10.1, §10.3). Sent when a student finalizes; run by the worker started in `startJobs`. */
export const GRADE_SUBMISSION = 'grade.submission';

// At most this many Gemini calls run at once, whoever the instructor is (TRD §10.2).
export const GRADING_CONCURRENCY = 3;

/**
 * Send a grading job. The singleton key means one job runs per submission (TRD §10.1). It does not stop two from waiting, so
 * the stale check in `gradeSubmission` is what keeps a second one harmless. `startAfterSeconds` delays the job (pg-boss counts it in seconds).
 */
export async function sendGradeJob(boss: PgBoss, job: GradeJob, startAfterSeconds?: number): Promise<void> {
  await boss.send(GRADE_SUBMISSION, job, { singletonKey: `grade:${job.submissionId}`, startAfter: startAfterSeconds });
}

/**
 * The sender the API gives to finalize. The worker starts in the background, so a finalize that arrives while it is still
 * starting waits for it. A failure is logged and swallowed: the submission stays `QUEUED` until it is re-run (REV-05).
 */
export function createGradingSender(bossReady: Promise<PgBoss>, logger: Logger): EnqueueGrading {
  return async (job) => {
    try {
      await sendGradeJob(await bossReady, job);
    } catch (error) {
      logger.error({ event: 'grading.enqueue_failed', submissionId: job.submissionId, err: error });
    }
  };
}

/**
 * The worker's handler. When the instructor's key has no token yet, the job is sent again to start when one is free, and this
 * one finishes normally. A thrown error fails the job, and pg-boss retries it.
 */
export function gradeSubmissionHandler(boss: PgBoss, deps: GradingDeps) {
  return async (jobs: Job<GradeJob>[]): Promise<void> => {
    for (const job of jobs) {
      try {
        const payload = GradeJobSchema.parse(job.data);
        const wait = await gradeSubmission(deps, payload, { attemptNo: job.retryCount + 1, signal: job.signal });
        if (wait) await sendGradeJob(boss, payload, wait.waitSeconds);
      } catch (error) {
        deps.logger.error({ event: 'jobs.failed', queue: GRADE_SUBMISSION, err: error });
        throw error;
      }
    }
  };
}
