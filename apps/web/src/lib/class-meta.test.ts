import { describe, expect, it } from 'vitest';
import { classMeta } from './class-meta';

describe('classMeta', () => {
  it('lists what was filled in, in a fixed order', () => {
    expect(classMeta({ section: 'B', subject: 'Biology', room: '4' })).toBe('Section B · Biology · Room 4');
  });

  it('skips what was left out', () => {
    expect(classMeta({ section: null, subject: 'Biology', room: null })).toBe('Biology');
    expect(classMeta({ section: 'B', subject: null, room: '4' })).toBe('Section B · Room 4');
  });

  it('does not repeat a label the instructor already typed', () => {
    expect(classMeta({ section: 'Section B', subject: null, room: 'room 4' })).toBe('Section B · room 4');
  });

  it('is empty when nothing was filled in', () => {
    expect(classMeta({ section: null, subject: null, room: null })).toBe('');
  });
});
