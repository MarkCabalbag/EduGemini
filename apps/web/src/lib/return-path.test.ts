import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it.each(['/classes/123?tab=people', '/signing-guide', '/classes#top'])('allows %j', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    undefined,
    42,
    '',
    'classes',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/signin',
    '/signup?x=1',
  ])('sends %j to the dashboard', (value) => {
    expect(safeReturnPath(value)).toBe('/classes');
  });
});
