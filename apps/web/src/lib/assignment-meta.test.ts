import { describe, expect, it } from 'vitest';
import type { GradeView } from '@edugemini/shared';
import { attemptsLeftText, gradeScoreText, resubmissionText, scoringText } from './assignment-meta';

describe('scoringText', () => {
  it('names the format, and the maximum only for points', () => {
    expect(scoringText({ scoringFormat: 'POINTS', maxScore: 50 })).toBe('50 points');
    expect(scoringText({ scoringFormat: 'PERCENTAGE', maxScore: 100 })).toBe('Percentage');
    expect(scoringText({ scoringFormat: 'LETTER_NUMERIC', maxScore: 100 })).toBe('Letter and number');
  });
});

describe('gradeScoreText', () => {
  const grade: GradeView = {
    source: 'AI',
    score: 42,
    maxScore: 50,
    scoringFormat: 'POINTS',
    letter: null,
    percentage: 84,
    feedback: 'Good.',
    chip: 'status-ai',
  };

  it('writes points as score / max and a percentage as a whole percent', () => {
    expect(gradeScoreText(grade)).toBe('42 / 50');
    expect(gradeScoreText({ ...grade, scoringFormat: 'PERCENTAGE', score: 84, maxScore: 100 })).toBe('84%');
  });

  it('writes a letter assignment as "B+ (87)", and as "87 / 100" while no letter exists', () => {
    const letterGrade: GradeView = { ...grade, scoringFormat: 'LETTER_NUMERIC', score: 87, maxScore: 100, percentage: 87 };
    expect(gradeScoreText({ ...letterGrade, letter: 'B+' })).toBe('B+ (87)');
    expect(gradeScoreText(letterGrade)).toBe('87 / 100');
  });
});

describe('attemptsLeftText', () => {
  it.each([
    [null, 'Unlimited resubmissions'],
    [0, '0 resubmissions left'],
    [1, '1 resubmission left'],
    [3, '3 resubmissions left'],
  ])('says %s as "%s"', (attemptsLeft, expected) => {
    expect(attemptsLeftText(attemptsLeft)).toBe(expected);
  });
});

describe('resubmissionText', () => {
  it.each([
    [null, 'Unlimited resubmissions'],
    [0, 'No resubmissions'],
    [1, '1 resubmission'],
    [3, '3 resubmissions'],
  ])('says %s as "%s"', (maxResubmissions, expected) => {
    expect(resubmissionText({ maxResubmissions })).toBe(expected);
  });
});
