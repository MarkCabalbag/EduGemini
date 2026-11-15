import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

describe('logger redaction (TRD §14)', () => {
  it('censors secrets at the top level and one level down', () => {
    const lines: string[] = [];
    const log = createLogger('info', 'test', { write: (line: string) => void lines.push(line) });

    log.info({
      password: 'hunter2',
      token: 'abc',
      user: { key: 'AIza-secret', ciphertext: 'zzz' },
      req: { headers: { authorization: 'Bearer x', cookie: 'eg_session=1' } },
      safe: 'visible',
    });

    const out = lines.join('');
    for (const secret of ['hunter2', 'abc', 'AIza-secret', 'zzz', 'Bearer x', 'eg_session=1']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('visible');
    expect(out).toContain('[redacted]');
  });
});
