/** A file the browser can upload: what `setInputFiles` takes. */
export type UploadFile = { name: string; mimeType: string; buffer: Buffer };

/**
 * A one-page PDF with a line of text, built by hand so the tests need no PDF library. The API opens every PDF to count its
 * pages, so the cross-reference table must point at the right byte offsets; they are computed, not hard-coded.
 */
export function onePagePdf(name = 'essay.pdf'): UploadFile {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream('BT /F1 18 Tf 72 720 Td (My essay about photosynthesis.) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(body, 'latin1') };
}

function stream(content: string): string {
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

/** A plain-text file: a type the upload control refuses when it is chosen. */
export function textFile(name = 'notes.txt'): UploadFile {
  return { name, mimeType: 'text/plain', buffer: Buffer.from('These are my notes, not a PDF.') };
}
