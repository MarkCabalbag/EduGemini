import { describe, expect, it } from 'vitest';
import { CreateClassSchema, JoinSchema, ListClassesQuerySchema, UpdateClassSchema } from './classes';

describe('JoinSchema', () => {
  it('trims and uppercases the code, so entry is case-insensitive', () => {
    expect(JoinSchema.parse({ code: '  ab3dEf9h ' })).toEqual({ code: 'AB3DEF9H' });
  });

  it.each(['', 'ABC', 'ABCDEFGHJ', '   '])('rejects the code %j', (code) => {
    expect(JoinSchema.safeParse({ code }).success).toBe(false);
  });
});

describe('ListClassesQuerySchema', () => {
  it('defaults to active classes, 25 to a page', () => {
    expect(ListClassesQuerySchema.parse({})).toEqual({ status: 'ACTIVE', limit: 25 });
  });

  it.each([
    ['1', 1],
    ['25', 25],
    ['100', 100],
    ['007', 7],
  ])('accepts a limit of %s', (limit, expected) => {
    expect(ListClassesQuerySchema.parse({ limit }).limit).toBe(expected);
  });

  // Number() would turn several of these into valid numbers. The API contract says a plain whole number.
  it.each(['0', '101', '0x10', '1e1', ' 5', '5.5', '-1', '', 'abc'])('rejects a limit of %j', (limit) => {
    expect(ListClassesQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an empty cursor and an unknown status', () => {
    expect(ListClassesQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(ListClassesQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });
});

describe('CreateClassSchema', () => {
  const valid = { name: 'Biology 101', attestation: { confirmed: true } };

  it.each([
    ['a NUL character', 'a\u0000b'],
    ['half of an emoji at the end', 'Bio\ud83d'],
    ['half of an emoji at the start', '\ude00Bio'],
  ])('refuses %s in every text field, which cannot be stored', (_label, text) => {
    for (const field of ['name', 'description', 'section', 'subject', 'room']) {
      expect(CreateClassSchema.safeParse({ ...valid, [field]: text }).success, field).toBe(false);
    }
  });

  it('accepts ordinary text, including accents and emoji', () => {
    expect(CreateClassSchema.safeParse({ ...valid, name: 'Matemáticas 📐', room: 'B-12' }).success).toBe(true);
  });
});

describe('UpdateClassSchema', () => {
  it('takes any of the five fields, trimmed, and nothing else is required', () => {
    expect(UpdateClassSchema.parse({})).toEqual({});
    expect(UpdateClassSchema.parse({ name: '  Physics ', room: '4' })).toEqual({ name: 'Physics', room: '4' });
  });

  it('keeps a blank optional field, so the service can clear it', () => {
    expect(UpdateClassSchema.parse({ section: '   ', description: '' })).toEqual({ section: '', description: '' });
  });

  it('refuses a blank name and a name over 120 characters', () => {
    expect(UpdateClassSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(UpdateClassSchema.safeParse({ name: 'a'.repeat(121) }).success).toBe(false);
  });

  it('refuses a field it does not edit, such as the join code', () => {
    expect(UpdateClassSchema.safeParse({ joinCode: 'ABCDEFGH' }).success).toBe(false);
    expect(UpdateClassSchema.safeParse({ name: 'Physics', requireApproval: true }).success).toBe(false);
  });

  it('refuses a NUL character or half an emoji in every text field, as create does', () => {
    for (const field of ['name', 'description', 'section', 'subject', 'room']) {
      expect(UpdateClassSchema.safeParse({ [field]: 'a\u0000b' }).success, field).toBe(false);
      expect(UpdateClassSchema.safeParse({ [field]: 'Bio\ud83d' }).success, field).toBe(false);
    }
  });
});
