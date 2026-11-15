import { describe, expect, it } from 'vitest';
import { joinLinkFor, newJoinCode } from './class-service';

describe('join link', () => {
  it('is the join page under the app address', () => {
    expect(joinLinkFor('http://localhost:5173', 'K7M2PQ9X')).toBe('http://localhost:5173/join/K7M2PQ9X');
  });

  it('keeps a path in the app address and ignores a trailing slash', () => {
    expect(joinLinkFor('https://host.example/edugemini/', 'K7M2PQ9X')).toBe('https://host.example/edugemini/join/K7M2PQ9X');
  });
});

describe('join code', () => {
  it('is 8 characters from the 32-character alphabet: no I, O, 0 or 1 (Backend Schema §4.7)', () => {
    for (let i = 0; i < 2000; i++) expect(newJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('is different each time', () => {
    expect(new Set(Array.from({ length: 200 }, newJoinCode)).size).toBe(200);
  });
});
