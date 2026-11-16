import type { AssignmentSummary } from '@edugemini/shared';

/** How an assignment is scored, in words: "50 points", "Percentage", "Letter and number". */
export function scoringText({ scoringFormat, maxScore }: Pick<AssignmentSummary, 'scoringFormat' | 'maxScore'>): string {
  if (scoringFormat === 'POINTS') return `${maxScore} points`;
  return scoringFormat === 'PERCENTAGE' ? 'Percentage' : 'Letter and number';
}

/** The resubmission limit in words; null is Unlimited (PRD FR-ASG-10). */
export function resubmissionText({ maxResubmissions }: Pick<AssignmentSummary, 'maxResubmissions'>): string {
  if (maxResubmissions === null) return 'Unlimited resubmissions';
  if (maxResubmissions === 0) return 'No resubmissions';
  return `${maxResubmissions} ${maxResubmissions === 1 ? 'resubmission' : 'resubmissions'}`;
}
