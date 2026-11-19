import { PgBoss, type Queue } from 'pg-boss';
import { GRADING_TRIES, type GradingDeps } from '../services/grading-service';
import { GRADE_SUBMISSION, GRADING_CONCURRENCY, gradeSubmissionHandler } from './grade-submission.job';
import { runStagedCleanup, STAGED_CLEANUP } from './staged-cleanup.job';
import { runStorageCleanup, STORAGE_CLEANUP } from './storage-cleanup.job';

// What the jobs need: the database, storage, the logger, and what grading uses (Gemini, the pacer, the key settings).
export type JobDeps = GradingDeps;

// Every queue of TRD §10.1, with its settings. A queue gets a worker when its job file is added to `jobs` below; until then it
// only exists, so the ticket that starts sending to it has nothing to set up.
const QUEUES: Record<string, Omit<Queue, 'name'>> = {
  // One job runs at a time per singleton key, which the sender sets to `grade:<submissionId>`. Retries as in TRD §10.7.
  'grade.submission': { policy: 'singleton', retryLimit: GRADING_TRIES - 1, retryDelay: 5, retryBackoff: true, retryDelayMax: 60 },
  'regrade.assignment': {},
  'send.email': { retryLimit: 5 },
  'digest.flush': {},
  'retention.sweep': {},
  [STAGED_CLEANUP]: {},
  [STORAGE_CLEANUP]: {},
};

/**
 * Start the pg-boss worker inside this process (TRD §3, §10.1). Every job is a file in this folder, run by the queue of its
 * name; add one to the list below. Each runs once now, because a free host that sleeps may never stay up for a whole hour,
 * and then on its schedule (UTC).
 *
 * The schema is not created here: the runtime role cannot, so `pnpm db:boss:init` installs it at deploy (Backend Schema §11).
 * `connectionString` is `PGBOSS_URL`, the session pooler. The caller stops the worker with `boss.stop()` at shutdown.
 */
export async function startJobs(connectionString: string, deps: JobDeps): Promise<PgBoss> {
  // A small pool: the free Supabase pooler allows few connections, and these jobs are light.
  const boss = new PgBoss({ connectionString, max: 4, migrate: false, application_name: 'edugemini-worker' });
  boss.on('error', (error) => deps.logger.error({ event: 'jobs.error', err: error }));
  boss.on('warning', (warning) => deps.logger.warn({ event: 'jobs.warning', warning }));
  await boss.start();

  for (const [queue, options] of Object.entries(QUEUES)) await boss.createQueue(queue, options);

  const jobs = [
    { queue: STAGED_CLEANUP, cron: '0 * * * *', run: () => runStagedCleanup(deps) }, // hourly
    { queue: STORAGE_CLEANUP, cron: '*/5 * * * *', run: () => runStorageCleanup(deps) }, // every 5 minutes
  ];
  for (const { queue, cron, run } of jobs) {
    await boss.work(queue, async () => {
      try {
        await run(); // a thrown error fails the job, and pg-boss retries it
      } catch (error) {
        deps.logger.error({ event: 'jobs.failed', queue, err: error });
        throw error;
      }
    });
    await boss.schedule(queue, cron);
    await boss.send(queue);
  }

  // Grading has no schedule and does not run at start: finalize sends one job per submission (AI-08). At most 3 run at once.
  await boss.work(GRADE_SUBMISSION, { localConcurrency: GRADING_CONCURRENCY }, gradeSubmissionHandler(boss, deps));
  return boss;
}
