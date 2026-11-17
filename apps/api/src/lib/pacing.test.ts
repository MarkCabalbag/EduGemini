import { describe, expect, it } from 'vitest';
import { createPacer } from './pacing';

function pacerAt(perMinute: number) {
  const clock = { now: 1_000_000 };
  return { clock, pacer: createPacer({ perMinute, now: () => clock.now }) };
}

describe('createPacer', () => {
  it('lets a full minute of calls go at once, then makes the next one wait for a token', () => {
    const { pacer } = pacerAt(5);
    for (let i = 0; i < 5; i++) expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBe(12); // one token every 60 / 5 seconds
  });

  it('gives a token back as time passes', () => {
    const { clock, pacer } = pacerAt(5);
    for (let i = 0; i < 5; i++) pacer.take('instructor-a');
    clock.now += 5_000;
    expect(pacer.take('instructor-a')).toBe(7); // 5 of the 12 seconds have passed
    clock.now += 7_000;
    expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBe(12);
  });

  it('does not hold more than a minute of tokens, however long it was idle', () => {
    const { clock, pacer } = pacerAt(5);
    pacer.take('instructor-a');
    clock.now += 10 * 60_000;
    for (let i = 0; i < 5; i++) expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBeGreaterThan(0);
  });

  it('counts each instructor on their own', () => {
    const { pacer } = pacerAt(2);
    expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBeGreaterThan(0);
    expect(pacer.take('instructor-b')).toBe(0);
  });

  it('does not use a token when it says to wait', () => {
    const { clock, pacer } = pacerAt(1);
    expect(pacer.take('instructor-a')).toBe(0);
    expect(pacer.take('instructor-a')).toBe(60);
    expect(pacer.take('instructor-a')).toBe(60); // asking again does not push the wait out
    clock.now += 60_000;
    expect(pacer.take('instructor-a')).toBe(0);
  });
});
