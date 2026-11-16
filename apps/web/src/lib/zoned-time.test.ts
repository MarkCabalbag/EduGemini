import { describe, expect, it } from 'vitest';
import { formatDue, timeZoneOptions, toInstant, toLocalInput } from './zoned-time';

describe('toInstant', () => {
  it('reads a clock in a zone without daylight saving', () => {
    expect(toInstant('2026-12-01T23:59', 'Asia/Manila')).toBe('2026-12-01T15:59:00.000Z'); // UTC+8
    expect(toInstant('2026-12-01T12:00', 'UTC')).toBe('2026-12-01T12:00:00.000Z');
  });

  it('uses the offset in force on that date, either side of a clock change', () => {
    expect(toInstant('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z'); // UTC-5
    expect(toInstant('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z'); // UTC-4
    expect(toInstant('2026-03-08T12:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z'); // after the change that day
    expect(toInstant('2026-03-08T01:00', 'America/New_York')).toBe('2026-03-08T06:00:00.000Z'); // before it
  });

  it('reads a zone ahead of UTC across a date line', () => {
    expect(toInstant('2026-12-01T00:30', 'Pacific/Auckland')).toBe('2026-11-30T11:30:00.000Z'); // UTC+13
  });
});

describe('toLocalInput', () => {
  it('shows a moment on the clock of the zone', () => {
    expect(toLocalInput('2026-12-01T15:59:00.000Z', 'Asia/Manila')).toBe('2026-12-01T23:59');
    expect(toLocalInput('2026-07-15T13:00:00.000Z', 'America/New_York')).toBe('2026-07-15T09:00');
  });

  it('is the reverse of toInstant', () => {
    for (const zone of ['Asia/Manila', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'UTC']) {
      expect(toLocalInput(toInstant('2026-10-20T08:15', zone), zone)).toBe('2026-10-20T08:15');
    }
  });
});

describe('timeZoneOptions', () => {
  it('lists zones in order, with UTC and any extra zone, once each', () => {
    const zones = timeZoneOptions('Asia/Manila', 'Custom/Zone');
    expect(zones).toContain('UTC');
    expect(zones).toContain('Asia/Manila');
    expect(zones).toContain('Custom/Zone');
    expect(zones.filter((zone) => zone === 'Asia/Manila')).toHaveLength(1);
    expect(zones).toEqual([...zones].sort());
  });
});

describe('formatDue', () => {
  it('shows the date on the clock of the zone it was set in, with the zone named', () => {
    // Newer ICU versions put a narrow no-break space before "PM", so the spaces are compared as plain ones.
    expect(formatDue('2026-12-01T15:59:00.000Z', 'Asia/Manila').replace(/\s/g, ' ')).toBe('Dec 1, 2026, 11:59 PM (Asia/Manila)');
  });
});
