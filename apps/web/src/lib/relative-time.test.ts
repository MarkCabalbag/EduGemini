import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('relativeTime', () => {
  it('says "now" for the last minute', () => {
    expect(relativeTime(ago(20), NOW)).toBe('now');
  });

  it('counts whole minutes, hours and days back', () => {
    expect(relativeTime(ago(5 * 60 + 40), NOW)).toBe('5 minutes ago');
    expect(relativeTime(ago(2 * 3600 + 59 * 60), NOW)).toBe('2 hours ago');
    expect(relativeTime(ago(3 * 86_400 + 3600), NOW)).toBe('3 days ago');
  });

  it('reads one day back as yesterday', () => {
    expect(relativeTime(ago(86_400 + 60), NOW)).toBe('yesterday');
  });
});
