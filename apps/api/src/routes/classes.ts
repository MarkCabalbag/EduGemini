import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import {
  ClassParamsSchema,
  CreateClassSchema,
  DeleteClassSchema,
  EnrolledQuerySchema,
  JoinSchema,
  ListClassesQuerySchema,
  UpdateClassSchema,
} from '@edugemini/shared';
import { refuseInstructor, requireAction } from '../middleware/authorize';
import { limiters } from '../middleware/rate-limit';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import {
  archiveClass,
  createClass,
  deleteClass,
  deletionImpact,
  disableCode,
  getClass,
  listClasses,
  regenerateCode,
  restoreClass,
  updateClass,
} from '../services/class-service';
import { joinClass, listEnrollments } from '../services/join-service';

/** `bucket` is the storage bucket whose objects a deleted class leaves for the storage outbox. */
type ClassDeps = { db: PrismaClient; appUrl: string; bucket: string };

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const create = { body: CreateClassSchema };
const list = { query: ListClassesQuerySchema };
const enrolled = { query: EnrolledQuerySchema };
const one = { params: ClassParamsSchema };
const edit = { params: ClassParamsSchema, body: UpdateClassSchema };
const remove = { params: ClassParamsSchema, body: DeleteClassSchema };
const join = { body: JoinSchema };

/**
 * Create, list, get, edit, archive, restore and delete a class, preview a deletion, regenerate or disable its code, join one by
 * code, and a student's Enrolled list (API Spec CLS-01 to CLS-09, CLS-11, JOIN-01, JOIN-03). The join link preview is in join-link.ts. Needs the session, so it is mounted
 * after loadSession.
 * The role check comes first on every route but get-one, so a role that cannot use them cannot tell they exist. The
 * services check again, and decide whether a class is the caller's own.
 */
export function classesRouter({ db, appUrl, bucket }: ClassDeps): Router {
  const router = Router();

  // The creation limit comes after validation, so a request with errors does not use it up.
  router.post('/classes', requireAuth, requireAction('class.create'), validate(create), limiters.classCreateByUser(), async (req, res) => {
    const { body } = validated(res, create);
    res.status(201).json(await createClass(db, req.auth!.user, body, appUrl));
  });

  router.get('/classes', requireAuth, requireAction('class.list'), validate(list), async (req, res) => {
    const { query } = validated(res, list);
    res.json(await listClasses(db, req.auth!.user, query, appUrl));
  });

  router.get('/me/enrollments', requireAuth, requireAction('class.listEnrolled'), validate(enrolled), async (req, res) => {
    const { query } = validated(res, enrolled);
    res.json(await listEnrollments(db, req.auth!.user, query));
  });

  // Instructors and students both ask for a class, so there is no role check here: the service decides, from the class
  // and, for a student, their enrollment in it.
  router.get('/classes/:classId', requireAuth, validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await getClass(db, req.auth!.user, params.classId, appUrl));
  });

  router.patch('/classes/:classId', requireAuth, requireAction('class.list'), validate(edit), async (req, res) => {
    const { params, body } = validated(res, edit);
    res.json(await updateClass(db, req.auth!.user, params.classId, body, appUrl));
  });

  router.delete('/classes/:classId', requireAuth, requireAction('class.list'), validate(remove), async (req, res) => {
    const { params, body } = validated(res, remove);
    await deleteClass(db, bucket, req.auth!.user, params.classId, body.confirmation);
    res.status(204).end();
  });

  router.get('/classes/:classId/deletion-impact', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await deletionImpact(db, req.auth!.user, params.classId));
  });

  router.post('/classes/:classId/archive', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await archiveClass(db, req.auth!.user, params.classId, appUrl));
  });

  router.post('/classes/:classId/restore', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await restoreClass(db, req.auth!.user, params.classId, appUrl));
  });

  router.post('/classes/:classId/code/regenerate', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await regenerateCode(db, req.auth!.user, params.classId, appUrl));
  });

  router.post('/classes/:classId/code/disable', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await disableCode(db, req.auth!.user, params.classId, appUrl));
  });

  // The limit comes after validation, so a code of the wrong length does not use up an attempt.
  router.post(
    '/join',
    requireAuth,
    refuseInstructor,
    requireAction('class.join'),
    validate(join),
    limiters.joinByUser(),
    async (req, res) => {
      const { body } = validated(res, join);
      const { result, created } = await joinClass(db, req.auth!.user, body.code);
      res.status(created ? 201 : 200).json(result);
    },
  );

  return router;
}
