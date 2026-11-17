import { rm } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import {
  AssignmentParamsSchema,
  FileParamsSchema,
  FinalizeSchema,
  LIMITS,
  ReferenceFileParamsSchema,
  UpdateReferenceFileSchema,
  VersionParamsSchema,
} from '@edugemini/shared';
import { AppError } from '../lib/app-error';
import type { StorageAdapter } from '../lib/storage';
import { requireAction } from '../middleware/authorize';
import { limiters } from '../middleware/rate-limit';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import { addReferenceFile, referenceFileUrl, removeReferenceFile, setReferenceVisibility } from '../services/assignment-service';
import type { EnqueueGrading } from '../services/grading-service';
import { removeFile, storeFile } from '../services/submission-file-service';
import { finalizeVersion, getMySubmission, openVersion } from '../services/submission-service';

const open = { params: AssignmentParamsSchema };
const send = { params: FileParamsSchema };
const finalize = { params: VersionParamsSchema, body: FinalizeSchema };
const referenceFile = { params: ReferenceFileParamsSchema };
const referenceVisibility = { params: ReferenceFileParamsSchema, body: UpdateReferenceFileSchema };

// A reference file arrives as a form with the file in it (API Spec REF-01). multer writes it to a temporary file, with the
// 10 MiB cap applied as it arrives; the service checks the type and stores it. The form envelope adds a little to the length.
const FORM_ENVELOPE_BYTES = 64 * 1024;
const takeOneFile = multer({ storage: multer.diskStorage({}), limits: { fileSize: LIMITS.maxFileBytes, files: 1, fields: 2 } }).single('file');

/** Reads the form, and turns what multer refuses into the API's own errors. */
const receiveFile: RequestHandler = (req, res, next) => {
  if (Number(req.headers['content-length']) > LIMITS.maxFileBytes + FORM_ENVELOPE_BYTES) {
    return next(new AppError('FILE_TOO_LARGE', { headers: { Connection: 'close' } })); // refused without reading the body
  }
  if (!req.is('multipart/form-data')) return next(new AppError('UNSUPPORTED_MEDIA_TYPE'));
  takeOneFile(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(error.code === 'LIMIT_FILE_SIZE' ? new AppError('FILE_TOO_LARGE') : new AppError('VALIDATION', { message: error.message }));
    }
    next(error);
  });
};

const MAX_NAME_BYTES = 255;

/** The name to show for the file, from X-File-Name (URL-encoded, at most 255 bytes). It is only text, so a missing or broken one becomes "file". */
function displayNameFrom(header: string | undefined): string {
  let name = '';
  try {
    name = decodeURIComponent(header ?? '');
  } catch {
    // a broken encoding counts as no name
  }
  const characters = [...name.replace(/\p{Cc}/gu, '').trim()]; // by code point, so a cut never leaves half an emoji
  while (Buffer.byteLength(characters.join('')) > MAX_NAME_BYTES) characters.pop();
  return characters.join('') || 'file';
}

/**
 * A student's submission: read it, open an upload, send and remove its files, finalize (API Spec SUB-01 to SUB-05).
 * Students only. Whether this student may use this class is the service's call, so the role check is "any student", as
 * `class.join` is for joining.
 */
export function uploadsRouter({
  db,
  storage,
  bucket,
  enqueueGrading,
}: {
  db: PrismaClient;
  storage: StorageAdapter;
  bucket: string;
  enqueueGrading: EnqueueGrading;
}): Router {
  const router = Router();
  const guard = [requireAuth, requireAction('class.listEnrolled')];
  const uploadLimit = limiters.uploadByUser(); // one counter for opening a version and for sending its files

  router.get('/assignments/:assignmentId/me', ...guard, validate(open), async (req, res) => {
    const { params } = validated(res, open);
    res.json(await getMySubmission(db, req.auth!.user, params.assignmentId));
  });

  router.post('/assignments/:assignmentId/versions', ...guard, validate(open), uploadLimit, async (req, res) => {
    const { params } = validated(res, open);
    const { created, version } = await openVersion(db, req.auth!.user, params.assignmentId);
    res.status(created ? 201 : 200).json(version);
  });

  // The body is the file itself, read by the service (json-body.ts lets this one route through).
  router.put('/versions/:versionId/files/:clientFileId', ...guard, validate(send), uploadLimit, async (req, res) => {
    const { params } = validated(res, send);
    if (req.is(['json', 'multipart', 'urlencoded'])) throw new AppError('UNSUPPORTED_MEDIA_TYPE');
    if (Number(req.headers['content-length']) > LIMITS.maxFileBytes) {
      throw new AppError('FILE_TOO_LARGE', { headers: { Connection: 'close' } }); // refused without reading the body
    }
    const { created, file } = await storeFile(db, storage, bucket, req.auth!.user, params.versionId, params.clientFileId, {
      body: req,
      displayName: displayNameFrom(req.get('X-File-Name')),
    });
    res.status(created ? 201 : 200).json(file);
  });

  router.delete('/versions/:versionId/files/:clientFileId', ...guard, validate(send), async (req, res) => {
    const { params } = validated(res, send);
    await removeFile(db, bucket, req.auth!.user, params.versionId, params.clientFileId);
    res.status(204).end();
  });

  router.post('/versions/:versionId/finalize', ...guard, validate(finalize), async (req, res) => {
    const { params, body } = validated(res, finalize);
    res.json(await finalizeVersion(db, bucket, req.auth!.user, params.versionId, body.expectedFileIds, enqueueGrading));
  });

  // The instructor's reference files (API Spec REF-01 to REF-04). The role check is "an instructor", as on the class routes;
  // the services decide whose class it is.
  const instructor = [requireAuth, requireAction('class.list')];

  router.post('/assignments/:assignmentId/reference-files', ...instructor, validate(open), receiveFile, async (req, res) => {
    const { params } = validated(res, open);
    if (!req.file) throw new AppError('VALIDATION', { fields: { file: 'Choose a file to add' } });
    try {
      res.status(201).json(await addReferenceFile(db, storage, bucket, req.auth!.user, params.assignmentId, req.file.path));
    } finally {
      await rm(req.file.path, { force: true });
    }
  });

  router.patch('/reference-files/:fileId', ...instructor, validate(referenceVisibility), async (req, res) => {
    const { params, body } = validated(res, referenceVisibility);
    res.json(await setReferenceVisibility(db, req.auth!.user, params.fileId, body.visibleToStudents));
  });

  router.delete('/reference-files/:fileId', ...instructor, validate(referenceFile), async (req, res) => {
    const { params } = validated(res, referenceFile);
    await removeReferenceFile(db, bucket, req.auth!.user, params.fileId);
    res.status(204).end();
  });

  // The owning instructor, or an approved student for a file marked visible: the service decides, so no role check here.
  router.get('/reference-files/:fileId/url', requireAuth, validate(referenceFile), async (req, res) => {
    const { params } = validated(res, referenceFile);
    res.json(await referenceFileUrl(db, storage, bucket, req.auth!.user, params.fileId));
  });

  return router;
}
