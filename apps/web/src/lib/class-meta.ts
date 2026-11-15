import type { ClassSummary } from '@edugemini/shared';

/** "Section B", unless the instructor already wrote "Section B" (then it is left as typed). */
const labelled = (label: string, value: string | null) =>
  value && (value.toLowerCase().startsWith(label.toLowerCase()) ? value : `${label} ${value}`);

/** The details an instructor filled in, in a fixed order: "Section B · Biology · Room 4". Empty when none were. */
export function classMeta({ section, subject, room }: Pick<ClassSummary, 'section' | 'subject' | 'room'>): string {
  return [labelled('Section', section), subject, labelled('Room', room)].filter(Boolean).join(' · ');
}
