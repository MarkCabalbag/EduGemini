import { describe, expect, it } from 'vitest';
import { KeyStatusSchema, SaveKeySchema } from './keys';

const key = (length: number) => 'a'.repeat(length);

describe('SaveKeySchema (API Spec KEY-02)', () => {
  it('trims the key and accepts 20 to 200 characters', () => {
    expect(SaveKeySchema.parse({ apiKey: `  ${key(20)} ` }).apiKey).toBe(key(20));
    expect(SaveKeySchema.safeParse({ apiKey: key(200) }).success).toBe(true);
  });

  it('refuses a key of 19 or 201 characters with a message that says which', () => {
    const short = SaveKeySchema.safeParse({ apiKey: key(19) });
    const long = SaveKeySchema.safeParse({ apiKey: key(201) });

    expect(short.error?.issues[0]?.message).toMatch(/too short/);
    expect(long.error?.issues[0]?.message).toMatch(/too long/);
  });

  it('asks for the key when it is missing, empty or only spaces', () => {
    for (const body of [{}, { apiKey: '' }, { apiKey: '    ' }]) {
      expect(SaveKeySchema.safeParse(body).error?.issues[0]?.message).toBe('Enter your Gemini key.');
    }
  });

  it('takes the acknowledgement as a boolean or leaves it out', () => {
    expect(SaveKeySchema.safeParse({ apiKey: key(20), disclosureAcknowledged: true }).success).toBe(true);
    expect(SaveKeySchema.safeParse({ apiKey: key(20) }).success).toBe(true);
    expect(SaveKeySchema.safeParse({ apiKey: key(20), disclosureAcknowledged: 'yes' }).success).toBe(false);
  });
});

describe('KeyStatusSchema', () => {
  it('accepts no key and a saved key, and refuses a last4 that is not four characters', () => {
    const none = { connected: false, status: null, last4: null, lastSuccessAt: null, disclosureAckAt: null };
    const saved = { connected: true, status: null, last4: 'wxyz', lastSuccessAt: null, disclosureAckAt: '2026-11-16T10:00:00.000Z' };

    expect(KeyStatusSchema.safeParse(none).success).toBe(true);
    expect(KeyStatusSchema.safeParse(saved).success).toBe(true);
    expect(KeyStatusSchema.safeParse({ ...saved, last4: 'wx' }).success).toBe(false);
  });
});
