import type { Job, PgBoss } from 'pg-boss';
import { GradeJobSchema, type GradeJob } from '@edugemini/shared';
import type { Logger } from '../lib/logger';
import { GRADING_TRIES, gradeSubmission, moveToManualReview, type EnqueueGrading, type GradingDeps } from '../services/grading-service';

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
 * The worker's handler (TRD §10.3, §10.7). When the instructor's key has no token yet, the job is sent again to start when one
 * is free, and this one finishes normally. The new job counts its own retries from zero, so the tries used so far go in its
 * payload (`tries`). A thrown error fails the job and pg-boss retries it, until the last try (`GRADING_TRIES`): then, whatever
 * went wrong, the submission goes to manual review with the cause `AI_FAILED` and the job finishes normally.
 */
export function gradeSubmissionHandler(boss: PgBoss, deps: GradingDeps) {
  return async (jobs: Job<GradeJob>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = GradeJobSchema.parse(job.data); // a payload that is not a job cannot be graded or sent to review
      const attemptNo = (payload.tries ?? 0) + job.retryCount + 1;
      try {
        const wait = await gradeSubmission(deps, payload, { attemptNo, signal: job.signal });
        if (wait) await sendGradeJob(boss, { ...payload, tries: attemptNo - 1 }, wait.waitSeconds);
      } catch (error) {
        deps.logger.error({ event: 'jobs.failed', queue: GRADE_SUBMISSION, attemptNo, err: error });
        if (attemptNo < GRADING_TRIES) throw error;
        await moveToManualReview(deps.db, payload, 'AI_FAILED');
        deps.logger.info({ event: 'grading.manual_review', submissionId: payload.submissionId, cause: 'AI_FAILED' });
      }
    }
  };
}
