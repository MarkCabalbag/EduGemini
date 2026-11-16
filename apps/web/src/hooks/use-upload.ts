import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LIMITS, type FileView, type VersionView } from '@edugemini/shared';
import { api, ApiRequestError } from '../lib/api';
import { errorText } from '../lib/error-text';
import { resizeImage } from '../lib/resize-image';
import { checkFile } from '../lib/upload-files';

/**
 * One file the student chose. `ready` waits its turn, `stored` is on the server, `failed` can be tried again (the network
 * or the server let it down), and `rejected` is the file's own problem, with the reason, so trying again would not help.
 */
export type UploadItem = {
  /** The browser's key for the file: the server replaces a file sent again with the same one, so a retry never doubles it (API Spec A7). */
  id: string;
  file: File;
  isImage: boolean;
  state: 'ready' | 'uploading' | 'stored' | 'failed' | 'rejected';
  message?: string;
};

// Answers that say "try again", as opposed to the server refusing the file itself.
const RETRYABLE = ['NETWORK', 'INTERNAL', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'];

function failureOf(error: unknown): Pick<UploadItem, 'state' | 'message'> {
  if (error instanceof ApiRequestError && !RETRYABLE.includes(error.code)) {
    return { state: 'rejected', message: errorText(error.code, error.details) };
  }
  return { state: 'failed', message: errorText(error instanceof ApiRequestError ? error.code : 'INTERNAL') };
}

/**
 * The files of one upload (API Spec A7, steps 1 and 2). The upload is opened when the first file is sent, and files go one
 * at a time, so a phone is never holding several photos in flight. Choosing the files does not submit anything: that is
 * the finalize step, which comes with its own ticket.
 */
export function useUpload(assignmentId: string) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const open = useMutation({ mutationFn: () => api<VersionView>(`/assignments/${assignmentId}/versions`, { method: 'POST' }) });
  const send = useMutation({
    mutationFn: ({ versionId, id, blob, name }: { versionId: string; id: string; blob: Blob; name: string }) =>
      api<FileView>(`/versions/${versionId}/files/${id}`, { method: 'PUT', file: { blob, name } }),
  });
  const versionId = useRef<Promise<string>>(undefined);
  const lastInLine = useRef<Promise<void>>(Promise.resolve());

  const change = (id: string, patch: Partial<UploadItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  /** The open upload's ID. Asked for once, and again only after a failure. */
  const openUpload = () => {
    versionId.current ??= open
      .mutateAsync()
      .then((version) => version.id)
      .catch((error: unknown) => {
        versionId.current = undefined;
        throw error;
      });
    return versionId.current;
  };

  async function sendOne(item: UploadItem) {
    change(item.id, { state: 'uploading', message: undefined });
    try {
      const version = await openUpload();
      const blob = item.isImage ? await resizeImage(item.file) : item.file;
      if (blob.size > LIMITS.maxFileBytes) return change(item.id, { state: 'rejected', message: errorText('FILE_TOO_LARGE') });
      await send.mutateAsync({ versionId: version, id: item.id, blob, name: item.file.name });
      change(item.id, { state: 'stored', message: undefined });
    } catch (error) {
      change(item.id, failureOf(error));
    }
  }

  const enqueue = (item: UploadItem) => {
    lastInLine.current = lastInLine.current.then(() => sendOne(item)); // sendOne never rejects, so the line never stops
  };

  async function addFiles(chosen: File[]) {
    const added = await Promise.all(
      chosen.map(async (file): Promise<UploadItem> => {
        const check = await checkFile(file);
        const id = crypto.randomUUID();
        if ('problem' in check) return { id, file, isImage: false, state: 'rejected', message: check.problem };
        return { id, file, isImage: check.kind.mimeType !== 'application/pdf', state: 'ready' };
      }),
    );
    setItems((list) => [...list, ...added]);
    added.filter((item) => item.state === 'ready').forEach(enqueue);
  }

  return {
    items,
    addFiles,
    retry: (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) enqueue(item);
    },
    /** Only for a file that was never stored. A stored file is removed with the upload's own endpoint (a later ticket). */
    remove: (id: string) => setItems((list) => list.filter((item) => item.id !== id)),
  };
}
