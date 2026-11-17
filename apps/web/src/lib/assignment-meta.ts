import type { AssignmentSummary, GradeView } from '@edugemini/shared';

/** How an assignment is scored, in words: "50 points", "Percentage", "Letter and number". */
export function scoringText({ scoringFormat, maxScore }: Pick<AssignmentSummary, 'scoringFormat' | 'maxScore'>): string {
  if (scoringFormat === 'POINTS') return `${maxScore} points`;
  return scoringFormat === 'PERCENTAGE' ? 'Percentage' : 'Letter and number';
}

/** A grade in the assignment's format (PRD §9.4): "42 / 50", "84%", "B+ (87)". Without a letter yet (AI-05), a letter assignment reads "87 / 100". */
export function gradeScoreText({ scoringFormat, score, maxScore, letter, percentage }: GradeView): string {
  if (scoringFormat === 'PERCENTAGE') return `${percentage}%`;
  if (scoringFormat === 'LETTER_NUMERIC' && letter) return `${letter} (${score})`;
  return `${score} / ${maxScore}`;
}

/** The resubmission limit in words; null is Unlimited (PRD FR-ASG-10). */
export function resubmissionText({ maxResubmissions }: Pick<AssignmentSummary, 'maxResubmissions'>): string {
  if (maxResubmissions === null) return 'Unlimited resubmissions';
  if (maxResubmissions === 0) return 'No resubmissions';
  return `${maxResubmissions} ${maxResubmissions === 1 ? 'resubmission' : 'resubmissions'}`;
}
