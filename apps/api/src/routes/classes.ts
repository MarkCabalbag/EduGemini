import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { ClassParamsSchema, CreateClassSchema, JoinSchema, ListClassesQuerySchema } from '@edugemini/shared';
import { refuseInstructor, requireAction } from '../middleware/authorize';
import { limiters } from '../middleware/rate-limit';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import { createClass, getClass, joinClass, listClasses } from '../services/class-service';

type ClassDeps = { db: PrismaClient; appUrl: string };

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const create = { body: CreateClassSchema };
const list = { query: ListClassesQuerySchema };
const one = { params: ClassParamsSchema };
const join = { body: JoinSchema };

/**
 * Create, list and get a class, and join one by code (API Spec CLS-01 to CLS-03, JOIN-01). The join link preview is in join-link.ts. Needs the session, so it is mounted after loadSession.
 * The role check comes first on every route, so a role that cannot use them cannot tell they exist. The services check
 * again, and decide whether a class is the caller's own.
 */
export function classesRouter({ db, appUrl }: ClassDeps): Router {
  const router = Router();

  // The creation limit comes after validation, so a request with errors does not use it up.
  router.post(
    '/classes',
    requireAuth,
    requireAction('class.create'),
    validate(create),
    limiters.classCreateByUser(),
    async (req, res) => {
      const { body } = validated(res, create);
      res.status(201).json(await createClass(db, req.auth!.user, body, appUrl));
    },
  );

  router.get('/classes', requireAuth, requireAction('class.list'), validate(list), async (req, res) => {
    const { query } = validated(res, list);
    res.json(await listClasses(db, req.auth!.user, query, appUrl));
  });

  // Whoever may list classes may ask for one; whether it is theirs is decided in the service.
  router.get('/classes/:classId', requireAuth, requireAction('class.list'), validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await getClass(db, req.auth!.user, params.classId, appUrl));
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
