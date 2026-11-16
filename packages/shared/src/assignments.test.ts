import { describe, expect, it } from 'vitest';
import { CreateAssignmentSchema, ListAssignmentsQuerySchema, RequiredCriteriaSchema, UpdateAssignmentSchema } from './assignments';

describe('CreateAssignmentSchema', () => {
  it('needs only a title', () => {
    expect(CreateAssignmentSchema.parse({ title: '  Essay 2 ' })).toEqual({ title: 'Essay 2' });
    expect(CreateAssignmentSchema.safeParse({}).success).toBe(false);
    expect(CreateAssignmentSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('accepts every writable field', () => {
    const full = {
      title: 'Essay 2',
      instructions: 'Write 500 words.',
      criteriaText: 'Thesis is clear (10 points).',
      dueAt: '2026-12-01T15:59:00.000Z',
      timezone: 'Asia/Manila',
      scoringFormat: 'POINTS',
      maxScore: 50,
      maxResubmissions: null,
      acceptLate: false,
    };
    expect(CreateAssignmentSchema.parse(full)).toEqual(full);
  });

  it.each([
    ['a title over 200 characters', { title: 'a'.repeat(201) }],
    ['criteria over 5000 characters', { criteriaText: 'a'.repeat(5001) }],
    ['a time zone that does not exist', { timezone: 'Mars/Olympus' }],
    ['a due date with no time', { dueAt: '2026-12-01' }],
    ['an unknown scoring format', { scoringFormat: 'STARS' }],
    ['a max score of 0', { maxScore: 0 }],
    ['a max score over 1000', { maxScore: 1001 }],
    ['11 resubmissions', { maxResubmissions: 11 }],
    ['-1 resubmissions', { maxResubmissions: -1 }],
    ['half a resubmission', { maxResubmissions: 1.5 }],
  ])('rejects %s', (_name, change) => {
    expect(CreateAssignmentSchema.safeParse({ title: 'Essay 2', ...change }).success).toBe(false);
  });

  it('takes 0 resubmissions and null (Unlimited)', () => {
    expect(CreateAssignmentSchema.parse({ title: 'A', maxResubmissions: 0 }).maxResubmissions).toBe(0);
    expect(CreateAssignmentSchema.parse({ title: 'A', maxResubmissions: null }).maxResubmissions).toBeNull();
  });
});

describe('RequiredCriteriaSchema', () => {
  it.each(['', '   '])('asks for criteria when given %j', (criteriaText) => {
    const result = RequiredCriteriaSchema.safeParse({ criteriaText });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Add grading criteria');
  });

  it('takes criteria and trims them', () => {
    expect(RequiredCriteriaSchema.parse({ criteriaText: ' Thesis is clear. ' })).toEqual({ criteriaText: 'Thesis is clear.' });
  });
});

describe('UpdateAssignmentSchema', () => {
  it('takes any of the fields, or none', () => {
    expect(UpdateAssignmentSchema.parse({})).toEqual({});
    expect(UpdateAssignmentSchema.parse({ acceptLate: false })).toEqual({ acceptLate: false });
  });

  it('still checks a field that is sent', () => {
    expect(UpdateAssignmentSchema.safeParse({ title: '' }).success).toBe(false);
  });
});

describe('ListAssignmentsQuerySchema', () => {
  it('lists every status, 25 to a page, unless told otherwise', () => {
    expect(ListAssignmentsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(ListAssignmentsQuerySchema.parse({ status: 'DRAFT' }).status).toBe('DRAFT');
  });

  it('rejects an unknown status', () => {
    expect(ListAssignmentsQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });
});
