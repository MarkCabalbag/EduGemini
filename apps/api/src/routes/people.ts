import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { ClassParamsSchema, ClassSettingsSchema, DecisionSchema, EnrollmentParamsSchema, PeopleQuerySchema } from '@edugemini/shared';
import { requireAction } from '../middleware/authorize';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import { approvePending, changeSettings, decideEnrollment, listPeople } from '../services/people-service';

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const settings = { params: ClassParamsSchema, body: ClassSettingsSchema };
const people = { params: ClassParamsSchema, query: PeopleQuerySchema };
const classOnly = { params: ClassParamsSchema };
const decision = { params: EnrollmentParamsSchema, body: DecisionSchema };

/**
 * Join approval and the people in a class (API Spec CLS-10, PPL-01 to PPL-03). The role check comes first, so a student
 * cannot tell these routes exist; the services decide whether the class is the caller's own. They fall under the general
 * limit, as no row of API Spec A12 gives them one.
 */
export function peopleRouter({ db }: { db: PrismaClient }): Router {
  const router = Router();
  // `class.manageMembers` needs the class to check, so the role check uses `class.list`: instructors only, as in classes.ts.
  const guard = [requireAuth, requireAction('class.list')];

  router.patch('/classes/:classId/settings', ...guard, validate(settings), async (req, res) => {
    const { params, body } = validated(res, settings);
    res.json(await changeSettings(db, req.auth!.user, params.classId, body));
  });

  router.get('/classes/:classId/people', ...guard, validate(people), async (req, res) => {
    const { params, query } = validated(res, people);
    res.json(await listPeople(db, req.auth!.user, params.classId, query));
  });

  router.post('/classes/:classId/approve-pending', ...guard, validate(classOnly), async (req, res) => {
    const { params } = validated(res, classOnly);
    res.json(await approvePending(db, req.auth!.user, params.classId));
  });

  router.post('/enrollments/:enrollmentId/decision', ...guard, validate(decision), async (req, res) => {
    const { params, body } = validated(res, decision);
    res.json(await decideEnrollment(db, req.auth!.user, params.enrollmentId, body));
  });

  return router;
}
