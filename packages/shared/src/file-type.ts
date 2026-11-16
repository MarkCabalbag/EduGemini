// What a submission file may be, found from its first bytes and never from its name or the type the browser declared
// (TRD §9.1, code-standards §9). The browser checks at selection and the API checks again, so both use this one list.
// HEIC (iPhone photos) comes with its own ticket, SUB-03, so for now it is not recognized.

export type FileKind = { mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; extension: 'pdf' | 'jpg' | 'png' };

/** The longest signature below: how many bytes of a file to read. */
export const SNIFF_BYTES = 8;

const SIGNATURES: { magic: number[]; kind: FileKind }[] = [
  { magic: [0x25, 0x50, 0x44, 0x46, 0x2d], kind: { mimeType: 'application/pdf', extension: 'pdf' } }, // %PDF-
  { magic: [0xff, 0xd8, 0xff], kind: { mimeType: 'image/jpeg', extension: 'jpg' } },
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], kind: { mimeType: 'image/png', extension: 'png' } },
];

/** The kind of file these first bytes start, or undefined when it is none of the allowed ones. */
export function sniffFileType(head: Uint8Array): FileKind | undefined {
  return SIGNATURES.find(({ magic }) => magic.every((byte, i) => head[i] === byte))?.kind;
}
