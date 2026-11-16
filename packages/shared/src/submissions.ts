import { z } from 'zod';
import { FileStatusSchema, VersionStatusSchema } from './enums';
import { safeText } from './text';

// Uploading a submission (API Spec A7, SUB-02 and SUB-03). The file bytes are not JSON, so only the path and the views are here.

export const VersionParamsSchema = z.object({ versionId: z.uuid() });

/** The browser makes `clientFileId`, so sending the same file again replaces it instead of adding a second one. */
export const FileParamsSchema = VersionParamsSchema.extend({ clientFileId: safeText(64).min(8) });

export const VersionViewSchema = z.object({
  id: z.uuid(),
  versionNo: z.number().int(),
  status: VersionStatusSchema,
  createdAt: z.iso.datetime(),
  storedAt: z.iso.datetime().nullable(),
});
export type VersionView = z.infer<typeof VersionViewSchema>;

export const FileViewSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  displayName: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  status: FileStatusSchema,
  /** TYPE, SIZE, PAGES, PASSWORD or CORRUPT on a FAILED file (Backend Schema §4.14); the database holds the list. */
  failureCode: z.string().nullable(),
});
export type FileView = z.infer<typeof FileViewSchema>;
