import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { LIMITS } from '@edugemini/shared';
import { AppError } from './app-error';

/**
 * The page count of a PDF on disk (TRD §9.1 step 2). A password-protected or unreadable file is FILE_ERROR and a long
 * one is FILE_LIMIT; the caller stores nothing for either.
 */
export async function countPdfPages(path: string): Promise<number> {
  const bytes = await readFile(path);
  let pages: number;
  try {
    pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    // In pdf-lib 1.17.1 an encrypted file's error fails `instanceof EncryptedPDFError`, and pdf-lib may not be able to read
    // the inside of an encrypted file at all. A file that names an /Encrypt entry is the password case; both are FILE_ERROR.
    throw new AppError('FILE_ERROR', { details: { failureCode: bytes.includes('/Encrypt') ? 'PASSWORD' : 'CORRUPT' } });
  }
  if (pages < 1) throw new AppError('FILE_ERROR', { details: { failureCode: 'CORRUPT' } });
  if (pages > LIMITS.maxPdfPages) throw new AppError('FILE_LIMIT', { details: { limit: 'pages' } });
  return pages;
}
