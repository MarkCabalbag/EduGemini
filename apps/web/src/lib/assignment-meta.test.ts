import { describe, expect, it } from 'vitest';
import { resubmissionText, scoringText } from './assignment-meta';

describe('scoringText', () => {
  it('names the format, and the maximum only for points', () => {
    expect(scoringText({ scoringFormat: 'POINTS', maxScore: 50 })).toBe('50 points');
    expect(scoringText({ scoringFormat: 'PERCENTAGE', maxScore: 100 })).toBe('Percentage');
    expect(scoringText({ scoringFormat: 'LETTER_NUMERIC', maxScore: 100 })).toBe('Letter and number');
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
