import { PDFDocument } from 'pdf-lib';

/** A real PDF with the given number of blank pages. */
export async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

/** The smallest file that says it is encrypted: the trailer points at an /Encrypt dictionary. pdf-lib cannot write one. */
export const ENCRYPTED_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj',
    '4 0 obj\n<< /Filter /Standard /V 1 /R 2 /P -4 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) >>\nendobj',
    'trailer\n<< /Root 1 0 R /Size 5 /Encrypt 4 0 R >>',
    'startxref\n0\n%%EOF',
  ].join('\n'),
);
