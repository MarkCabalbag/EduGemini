import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/app-error';
import { localFilePath, localSignature } from '../lib/local-storage';
import { validate, validated } from '../middleware/validate';

const files = {
  query: z.object({
    bucket: z.string().min(1),
    path: z.string().min(1),
    expires: z.coerce.number().int(),
    sig: z.string().length(64),
  }),
};

/**
 * Serves the links the local storage signs, as Supabase serves its own (API Spec C.4). Mounted only when
 * STORAGE_DRIVER=local, like the fake mailer's outbox route. The signature is the only check, so every failure
 * (bad signature, expired link, missing file) is the same NOT_FOUND.
 */
export function devFilesRouter({ dir, secret }: { dir: string; secret: string }): Router {
  const router = Router();

  router.get('/dev/files', validate(files), (_req, res, next) => {
    const { query } = validated(res, files);
    const expected = Buffer.from(localSignature(secret, query.bucket, query.path, query.expires));
    const given = Buffer.from(query.sig);
    const valid = given.length === expected.length && timingSafeEqual(given, expected);
    if (!valid || query.expires * 1000 <= Date.now()) return next(new AppError('NOT_FOUND'));

    // `dotfiles: 'allow'` because the default folder is .storage.
    res.sendFile(localFilePath(dir, query.bucket, query.path), { dotfiles: 'allow', headers: { 'Content-Disposition': 'inline' } }, (error) => {
      if (error) next(new AppError('NOT_FOUND'));
    });
  });

  return router;
}
