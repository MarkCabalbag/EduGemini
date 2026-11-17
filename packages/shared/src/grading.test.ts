import { describe, expect, it } from 'vitest';
import { GradeJobSchema, GradeModeSchema, GradeOutputSchema } from './grading';

const ID = '3f6c1c52-8a0e-4c57-9d5c-0d3f4a9f7b11';

describe('GradeJobSchema (TRD §10.1)', () => {
  it('accepts every mode and nothing else', () => {
    for (const mode of ['first', 'resubmit', 'regrade_criteria', 'rerun', 'regrade_approved']) {
      expect(GradeJobSchema.safeParse({ submissionId: ID, versionId: ID, mode }).success, mode).toBe(true);
    }
    expect(GradeModeSchema.safeParse('regrade').success).toBe(false);
  });

  it('needs both ids', () => {
    expect(GradeJobSchema.safeParse({ versionId: ID, mode: 'first' }).success).toBe(false);
    expect(GradeJobSchema.safeParse({ submissionId: ID, versionId: 'nope', mode: 'first' }).success).toBe(false);
  });
});

describe('GradeOutputSchema (API Spec C.1)', () => {
  const valid = { score: 42, feedback: 'Good work.', confidence: 'high', readabilityIssue: false };

  it('accepts the documented answer', () => {
    expect(GradeOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a score that is not a finite number, and feedback that is empty after trimming', () => {
    expect(GradeOutputSchema.safeParse({ ...valid, score: '42' }).success).toBe(false);
    expect(GradeOutputSchema.safeParse({ ...valid, score: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(GradeOutputSchema.safeParse({ ...valid, feedback: '   ' }).success).toBe(false);
  });

  it('refuses a confidence outside high, medium and low, and a missing readability flag', () => {
    expect(GradeOutputSchema.safeParse({ ...valid, confidence: 'certain' }).success).toBe(false);
    expect(GradeOutputSchema.safeParse({ score: 1, feedback: 'ok', confidence: 'low' }).success).toBe(false);
  });

  it('does not keep a letter the model sends anyway (the server derives it)', () => {
    expect(GradeOutputSchema.parse({ ...valid, letter: 'A' })).not.toHaveProperty('letter');
  });
});
