import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, ErrorCodeSchema } from './errors';

// Docs may have CRLF line endings on Windows checkouts.
const docs = (name: string) => readFileSync(resolve(__dirname, '../../../docs', name), 'utf8').replace(/\r\n/g, '\n');

describe('error catalog', () => {
  it('matches the API Spec A4 table, code and status', () => {
    const section = docs('api-spec.md').split('**Catalog.**')[1]?.split('**Standard error sets.**')[0] ?? '';
    const rows = [...section.matchAll(/^\| `([A-Z_]+)` \| (\d{3}) \|/gm)].map((m) => [m[1], Number(m[2])] as const);
    expect(rows.length).toBe(42);
    expect(Object.fromEntries(rows)).toEqual(ERROR_STATUS);
  });

  it('matches the ErrorCode enum in openapi.yaml', () => {
    const block =
      docs('openapi.yaml')
        .split(/^ {4}ErrorCode:\n/m)[1]
        ?.split(/^ {4}Error:\n/m)[0] ?? '';
    const codes = [...block.matchAll(/^ {8}- ([A-Z_]+)$/gm)].map((m) => m[1]);
    expect([...codes].sort()).toEqual([...ErrorCodeSchema.options].sort());
  });
});
