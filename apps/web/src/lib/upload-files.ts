import { LIMITS, MiB, SNIFF_BYTES, sniffFileType, type FileKind } from '@edugemini/shared';
import { errorText } from './error-text';

/** "1.8 MB". A megabyte is 1024 x 1024 bytes here, as in the limits. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MiB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MiB).toFixed(1)} MB`;
}

/**
 * The check when a file is chosen (App Flow §6 step 4): the type comes from the file's first bytes, never from its name,
 * as on the server. A PDF over the size limit is refused here too; an image may be bigger, because it is made smaller
 * before it is sent. The reason is the text the student reads.
 */
export async function checkFile(file: File): Promise<{ kind: FileKind } | { problem: string }> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return { problem: errorText('FILE_ERROR') }; // for example a file that was moved or deleted after it was chosen
  }
  const kind = sniffFileType(head);
  if (!kind) return { problem: errorText('FILE_TYPE') };
  if (kind.mimeType === 'application/pdf' && file.size > LIMITS.maxFileBytes) return { problem: errorText('FILE_TOO_LARGE') };
  return { kind };
}
