import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

/** Parse a .env file into a record. Comments and blank lines are skipped. */
function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const example = parseDotenv(readFileSync(resolve(__dirname, '../../../../.env.example'), 'utf8'));

describe('env', () => {
  it('accepts .env.example as written, so a fresh clone starts', () => {
    const env = parseEnv(example);
    expect(env.PORT).toBe(4000);
    expect(env.MAIL_DRIVER).toBe('fake');
    expect(env.GEMINI_MODE).toBe('fake');
  });

  it('reports every problem at once', () => {
    expect(() => parseEnv({})).toThrowError(/APP_URL[\s\S]*DATABASE_URL[\s\S]*SESSION_SECRET/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => parseEnv({ ...example, ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrowError(/ENCRYPTION_KEY/);
  });

  it('requires SMTP settings only when MAIL_DRIVER=smtp', () => {
    expect(() => parseEnv({ ...example, MAIL_DRIVER: 'smtp' })).toThrowError(/SMTP_HOST/);
    const env = parseEnv({ ...example, MAIL_DRIVER: 'smtp', SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect(env.SMTP_PORT).toBe(587);
  });

  it('always needs the bucket name and the Supabase URL and key, with no default for any of them', () => {
    for (const name of ['STORAGE_BUCKET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const { [name]: _left, ...without } = example;
      expect(() => parseEnv(without), name).toThrowError(new RegExp(name));
    }
    expect(() => parseEnv({ ...example, SUPABASE_URL: 'not a url' })).toThrowError(/SUPABASE_URL/);
  });

  it('refuses the fake mailer and the fake Gemini in production', () => {
    expect(() => parseEnv({ ...example, NODE_ENV: 'production' })).toThrowError(/MAIL_DRIVER[\s\S]*GEMINI_MODE/);
  });
});
