import { describe, expect, it } from 'vitest';
import { sniffFileType } from './file-type';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffFileType', () => {
  it('knows a PDF by %PDF-', () => {
    expect(sniffFileType(text('%PDF-1.7\n'))).toEqual({ mimeType: 'application/pdf', extension: 'pdf' });
  });

  it('knows a JPEG by FF D8 FF', () => {
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('knows a PNG by its eight byte signature', () => {
    expect(sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('refuses everything else, however it is named', () => {
    expect(sniffFileType(text('hello, this is plain text'))).toBeUndefined();
    expect(sniffFileType(text('<html><body>%PDF-</body></html>'))).toBeUndefined(); // the signature must be at the start
    expect(sniffFileType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeUndefined(); // a Windows program
    expect(sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeUndefined(); // a zip, which is also what a .docx is
  });

  it('does not know HEIC yet: that comes with SUB-03', () => {
    expect(sniffFileType(new Uint8Array([0, 0, 0, 0x18, ...text('ftypheic')]))).toBeUndefined();
  });

  it('refuses a file that is empty or cut short', () => {
    expect(sniffFileType(new Uint8Array(0))).toBeUndefined();
    expect(sniffFileType(bytes(0x89, 0x50, 0x4e))).toBeUndefined();
    expect(sniffFileType(text('%PDF'))).toBeUndefined();
  });
});
