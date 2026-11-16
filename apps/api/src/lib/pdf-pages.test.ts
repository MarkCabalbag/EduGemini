import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '@edugemini/shared';
import { ENCRYPTED_PDF, makePdf } from '../test/pdf-fixtures';
import { countPdfPages } from './pdf-pages';

let dir: string;
let counter = 0;

/** Writes the bytes to a file and counts the pages of that file, as the upload does with its temporary file. */
async function countOf(bytes: Buffer): Promise<number> {
  const path = join(dir, `file-${++counter}.pdf`);
  await writeFile(path, bytes);
  return countPdfPages(path);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edugemini-pdf-test-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('countPdfPages', () => {
  it('counts the pages of a PDF, up to the limit', async () => {
    expect(await countOf(await makePdf(1))).toBe(1);
    expect(await countOf(await makePdf(LIMITS.maxPdfPages))).toBe(LIMITS.maxPdfPages);
  });

  it('refuses a PDF with more pages than the limit, naming the limit', async () => {
    await expect(countOf(await makePdf(LIMITS.maxPdfPages + 1))).rejects.toMatchObject({
      code: 'FILE_LIMIT',
      details: { limit: 'pages' },
    });
  });

  it('refuses a password-protected PDF', async () => {
    await expect(countOf(ENCRYPTED_PDF)).rejects.toMatchObject({ code: 'FILE_ERROR', details: { failureCode: 'PASSWORD' } });
  });

  it('refuses a truncated PDF and a file that only starts like one', async () => {
    const whole = await makePdf(3);
    await expect(countOf(whole.subarray(0, Math.floor(whole.length / 2)))).rejects.toMatchObject({
      code: 'FILE_ERROR',
      details: { failureCode: 'CORRUPT' },
    });
    await expect(countOf(Buffer.from('%PDF-1.4\n% a tiny pretend document\n'))).rejects.toMatchObject({
      code: 'FILE_ERROR',
      details: { failureCode: 'CORRUPT' },
    });
  });
});
