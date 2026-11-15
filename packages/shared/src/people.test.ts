import { describe, expect, it } from 'vitest';
import { ClassSettingsSchema, DecisionSchema, PeopleQuerySchema } from './people';

describe('PeopleQuerySchema', () => {
  it('lists every status, 25 to a page, unless told otherwise', () => {
    expect(PeopleQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(PeopleQuerySchema.parse({ status: 'PENDING', limit: '100' })).toEqual({ status: 'PENDING', limit: 100 });
  });

  it.each([{ status: 'GONE' }, { status: 'pending' }, { limit: '0' }, { limit: '101' }, { limit: '1e1' }, { cursor: '' }])(
    'rejects %j',
    (query) => {
      expect(PeopleQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('DecisionSchema', () => {
  it.each(['APPROVE', 'DECLINE', 'REVERSE', 'REMOVE'])('accepts %s', (action) => {
    expect(DecisionSchema.parse({ action })).toEqual({ action });
  });

  it.each([{}, { action: 'DELETE' }, { action: 'approve' }, { action: null }])('rejects %j', (body) => {
    expect(DecisionSchema.safeParse(body).success).toBe(false);
  });
});

describe('ClassSettingsSchema', () => {
  it('needs a real boolean', () => {
    expect(ClassSettingsSchema.parse({ requireApproval: false })).toEqual({ requireApproval: false });
    expect(ClassSettingsSchema.safeParse({ requireApproval: 'true' }).success).toBe(false);
    expect(ClassSettingsSchema.safeParse({}).success).toBe(false);
  });
});
