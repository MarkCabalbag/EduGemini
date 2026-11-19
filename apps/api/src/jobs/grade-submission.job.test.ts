import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import type { GradeJob } from '@edugemini/shared';
import type { Logger } from '../lib/logger';
import { createGradingSender, GRADE_SUBMISSION, sendGradeJob } from './grade-submission.job';

const job: GradeJob = {
  submissionId: '6f1f5c7e-1b8a-4a5e-9d3c-2b7a1c0e4f11',
  versionId: '0a9d1c52-83f4-4e2a-b6a1-5e3f7d2c9b08',
  mode: 'first',
};
const bossWith = (send = vi.fn()) => ({ send }) as unknown as PgBoss;
const loggerWith = (error = vi.fn()) => ({ error }) as unknown as Logger;

describe('sendGradeJob', () => {
  it('sends the payload to the grading queue with the submission as the singleton key', async () => {
    const send = vi.fn();
    await sendGradeJob(bossWith(send), job);
    expect(send).toHaveBeenCalledWith(GRADE_SUBMISSION, job, { singletonKey: `grade:${job.submissionId}`, startAfter: undefined });
  });

  it('delays the job by the given seconds', async () => {
    const send = vi.fn();
    await sendGradeJob(bossWith(send), job, 12);
    expect(send).toHaveBeenCalledWith(GRADE_SUBMISSION, job, { singletonKey: `grade:${job.submissionId}`, startAfter: 12 });
  });
});

describe('createGradingSender', () => {
  it('waits for the worker to start, then sends', async () => {
    const send = vi.fn();
    let ready!: (boss: PgBoss) => void;
    const sender = createGradingSender(new Promise<PgBoss>((resolve) => (ready = resolve)), loggerWith());

    const sending = sender(job);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    ready(bossWith(send));
    await sending;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('logs a failed send and does not throw, so finalize still answers', async () => {
    const error = vi.fn();
    const sender = createGradingSender(Promise.resolve(bossWith(vi.fn().mockRejectedValue(new Error('queue is down')))), loggerWith(error));

    await expect(sender(job)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'grading.enqueue_failed', submissionId: job.submissionId }));
  });

  it('logs and does not throw when the worker never started', async () => {
    const error = vi.fn();
    const sender = createGradingSender(Promise.reject(new Error('no pg-boss schema')), loggerWith(error));

    await expect(sender(job)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
  });
});
