import { LIMITS } from '@edugemini/shared';
import { describe, expect, it } from 'vitest';
import { checkFile, formatSize } from './upload-files';

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];

describe('formatSize', () => {
  it('writes bytes, KB and MB', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('2 KB');
    expect(formatSize(1.8 * 1024 * 1024)).toBe('1.8 MB');
    expect(formatSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('checkFile', () => {
  it('accepts a PDF, JPEG or PNG by its first bytes, whatever it is called', async () => {
    const named = (bytes: number[], name: string) => new File([new Uint8Array(bytes)], name);
    expect(await checkFile(named([...PDF_BYTES, 1], 'notes.txt'))).toEqual({ kind: { mimeType: 'application/pdf', extension: 'pdf' } });
    expect(await checkFile(named([0xff, 0xd8, 0xff, 0xe0], 'scan.dat'))).toMatchObject({ kind: { mimeType: 'image/jpeg' } });
    expect(await checkFile(named([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'x'))).toMatchObject({
      kind: { mimeType: 'image/png' },
    });
  });

  it('refuses another type with the message, even when it is called .pdf and declared as one', async () => {
    const result = await checkFile(new File(['plain text'], 'essay.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({ problem: "This file type isn't supported. Use PDF, JPG, or PNG." });
  });

  it('refuses an empty file', async () => {
    expect(await checkFile(new File([], 'empty.pdf'))).toMatchObject({ problem: expect.stringContaining("isn't supported") });
  });

  it('refuses a PDF over the size limit, but leaves a big image to be made smaller', async () => {
    const big = (bytes: number[]) => {
      const data = new Uint8Array(LIMITS.maxFileBytes + 1);
      data.set(bytes);
      return new File([data], 'big');
    };
    expect(await checkFile(big(PDF_BYTES))).toEqual({ problem: 'This file is larger than 10 MB.' });
    expect(await checkFile(big([0xff, 0xd8, 0xff]))).toMatchObject({ kind: { mimeType: 'image/jpeg' } });
  });

  it('says the file could not be read when it cannot be', async () => {
    const unreadable = new File(['x'], 'gone.pdf');
    Object.defineProperty(unreadable, 'slice', { value: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) });
    expect(await checkFile(unreadable)).toMatchObject({ problem: expect.stringContaining("couldn't be read") });
  });
});
