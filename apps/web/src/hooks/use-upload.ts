import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LIMITS, type DraftVersion, type FileView, type StudentSubmission, type VersionView } from '@edugemini/shared';
import { api, ApiRequestError } from '../lib/api';
import { errorText, errorTextOf } from '../lib/error-text';
import { resizeImage } from '../lib/resize-image';
import { checkFile } from '../lib/upload-files';
import { submissionKeys } from './use-submission';

/**
 * One file in the upload. `ready` waits its turn, `stored` is on the server, `removing` is being taken off it, `failed` can
 * be tried again (the network or the server let it down), and `rejected` is the file's own problem, with the reason, so
 * trying again would not help.
 */
export type UploadItem = {
  /** The browser's key for the file: the server replaces a file sent again with the same one, so a retry never doubles it (API Spec A7). */
  id: string;
  name: string;
  size: number;
  /** The file the student chose. A file stored by an earlier visit has none: it is only shown and removed. */
  file?: File;
  isImage: boolean;
  state: 'ready' | 'uploading' | 'stored' | 'removing' | 'failed' | 'rejected';
  /** How much of the file has been sent, while it is `uploading`. */
  percent?: number;
  message?: string;
};

// Answers that say "try again", as opposed to the server refusing the file itself.
const RETRYABLE = ['NETWORK', 'INTERNAL', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'];

function failureOf(error: unknown): Pick<UploadItem, 'state' | 'message'> {
  if (error instanceof ApiRequestError && !RETRYABLE.includes(error.code)) {
    return { state: 'rejected', message: errorText(error.code, error.details) };
  }
  return { state: 'failed', message: errorTextOf(error) };
}

/** The files an earlier visit already stored in the open upload, so the student picks up where they stopped. */
const storedBefore = (draft: DraftVersion | null): UploadItem[] =>
  (draft?.files ?? [])
    .filter((file) => file.status === 'STORED')
    .map((file) => ({ id: file.clientFileId, name: file.displayName, size: file.sizeBytes ?? 0, isImage: false, state: 'stored' }));

/**
 * The files of one upload (API Spec A7). The upload is opened when the first file is sent, or is the one the page found
 * already open, and files go one at a time, so a phone is never holding several photos in flight. Choosing files submits
 * nothing: `submit` finalizes the upload with the files that were stored, and the answer is the receipt, which replaces
 * this control on the page. For a resubmission the page passes `onClose`, which is called when the upload ends, submitted or
 * cancelled (API Spec SUB-06), so the page can put its Resubmit button back.
 */
export function useUpload(assignmentId: string, draft: DraftVersion | null, onClose?: () => void) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>(() => storedBefore(draft));
  const open = useMutation({ mutationFn: () => api<VersionView>(`/assignments/${assignmentId}/versions`, { method: 'POST' }) });
  const send = useMutation({
    mutationFn: ({
      versionId,
      id,
      blob,
      name,
      onProgress,
    }: {
      versionId: string;
      id: string;
      blob: Blob;
      name: string;
      onProgress: (percent: number) => void;
    }) => api<FileView>(`/versions/${versionId}/files/${id}`, { method: 'PUT', file: { blob, name }, onProgress }),
  });
  const take = useMutation({
    mutationFn: ({ versionId, id }: { versionId: string; id: string }) => api(`/versions/${versionId}/files/${id}`, { method: 'DELETE' }),
  });
  const finalize = useMutation({
    mutationFn: ({ versionId, ids }: { versionId: string; ids: string[] }) =>
      api<StudentSubmission>(`/versions/${versionId}/finalize`, { method: 'POST', body: { expectedFileIds: ids } }),
    onSuccess: (submission) => {
      queryClient.setQueryData(submissionKeys.mine(assignmentId), submission);
      onClose?.();
    },
  });
  const cancelOpen = useMutation({
    mutationFn: (versionId: string) => api(`/versions/${versionId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      // The upload is gone, so the page must not find it again in the answer it already has. A refresh that is already on its
      // way (the page asks every 5 seconds while a grade is pending) would bring the old answer back, so it is stopped first.
      await queryClient.cancelQueries({ queryKey: submissionKeys.mine(assignmentId) });
      queryClient.setQueryData(
        submissionKeys.mine(assignmentId),
        (mine: StudentSubmission | undefined) => mine && { ...mine, draftVersion: null },
      );
      onClose?.();
    },
  });
  const versionId = useRef<Promise<string> | undefined>(draft ? Promise.resolve(draft.id) : undefined);
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
    if (!item.file) return; // only a file the student chose can be sent
    change(item.id, { state: 'uploading', percent: 0, message: undefined });
    try {
      const version = await openUpload();
      const blob = item.isImage ? await resizeImage(item.file) : item.file;
      if (blob.size > LIMITS.maxFileBytes) return change(item.id, { state: 'rejected', message: errorText('FILE_TOO_LARGE') });
      await send.mutateAsync({
        versionId: version,
        id: item.id,
        blob,
        name: item.name,
        onProgress: (percent) => change(item.id, { percent }),
      });
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
        const item = { id, name: file.name, size: file.size, file };
        if ('problem' in check) return { ...item, isImage: false, state: 'rejected', message: check.problem };
        return { ...item, isImage: check.kind.mimeType !== 'application/pdf', state: 'ready' };
      }),
    );
    setItems((list) => [...list, ...added]);
    added.filter((item) => item.state === 'ready').forEach(enqueue);
  }

  /**
   * A stored file is taken off the server with the upload's own endpoint (API Spec SUB-04), and stays in the list, marked
   * Removing, until that is done. Any other file is not on the server as far as the page knows, so it is only dropped.
   */
  async function remove(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (item?.state !== 'stored') return setItems((list) => list.filter((candidate) => candidate.id !== id));
    change(id, { state: 'removing', message: undefined });
    try {
      await take.mutateAsync({ versionId: await openUpload(), id });
      setItems((list) => list.filter((candidate) => candidate.id !== id));
    } catch (error) {
      change(id, { state: 'stored', message: `Couldn't remove it. ${errorTextOf(error)}` });
    }
  }

  // Submit waits until every file is stored. A failed or refused file has to be retried or removed first.
  const stored = items.filter((item) => item.state === 'stored');
  const waiting = items.filter((item) => item.state === 'ready' || item.state === 'uploading' || item.state === 'removing').length;
  const stuck = items.length - stored.length - waiting;

  /** Finalize with the stored files, in the order shown (API Spec SUB-05). The version is already open, since a file is stored in it. */
  async function submit() {
    const versionId = await openUpload();
    await finalize.mutateAsync({ versionId, ids: stored.map((item) => item.id) }).catch(() => undefined); // the error is `submitError`
  }

  /** Throw the upload away. Nothing is on the server until the first file is sent, so then there is nothing to delete. */
  async function cancel() {
    if (!versionId.current) return onClose?.();
    await cancelOpen.mutateAsync(await versionId.current).catch(() => undefined); // the error is `cancelError`
  }

  return {
    items,
    addFiles,
    retry: (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) enqueue(item);
    },
    remove,
    submit,
    submitting: finalize.isPending,
    submitError: finalize.error ? errorTextOf(finalize.error) : undefined,
    cancel,
    cancelling: cancelOpen.isPending,
    cancelError: cancelOpen.error ? errorTextOf(cancelOpen.error) : undefined,
    /** How many files are stored, still on their way, and failed or refused. */
    counts: { stored: stored.length, waiting, stuck },
  };
}
