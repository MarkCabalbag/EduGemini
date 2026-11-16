import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import {
  AssignmentParamsSchema,
  ClassParamsSchema,
  CreateAssignmentSchema,
  ListAssignmentsQuerySchema,
  UpdateAssignmentSchema,
} from '@edugemini/shared';
import { requireAction } from '../middleware/authorize';
import { requireAuth } from '../middleware/session';
import { validate, validated } from '../middleware/validate';
import {
  createAssignment,
  getAssignment,
  listAssignments,
  publishAssignment,
  updateAssignment,
} from '../services/assignment-service';

// What each route accepts, named once so `validate` and `validated` cannot drift apart.
const create = { params: ClassParamsSchema, body: CreateAssignmentSchema };
const list = { params: ClassParamsSchema, query: ListAssignmentsQuerySchema };
const update = { params: AssignmentParamsSchema, body: UpdateAssignmentSchema };
const one = { params: AssignmentParamsSchema };

/**
 * Create, list, get, edit and publish an assignment (API Spec ASG-01 to ASG-04, ASG-06). All of it is for the owning
 * instructor for now: the role check comes first, so a student cannot tell these routes exist, and the services decide
 * whether the class is the caller's own. They fall under the general limit, as no row of API Spec A12 gives them one.
 */
export function assignmentsRouter({ db }: { db: PrismaClient }): Router {
  const router = Router();
  // `assignment.write` needs the class to check, so the role check uses `class.list`: instructors only, as in people.ts.
  const guard = [requireAuth, requireAction('class.list')];

  router.post('/classes/:classId/assignments', ...guard, validate(create), async (req, res) => {
    const { params, body } = validated(res, create);
    res.status(201).json(await createAssignment(db, req.auth!.user, params.classId, body));
  });

  router.get('/classes/:classId/assignments', ...guard, validate(list), async (req, res) => {
    const { params, query } = validated(res, list);
    res.json(await listAssignments(db, req.auth!.user, params.classId, query));
  });

  router.get('/assignments/:assignmentId', ...guard, validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await getAssignment(db, req.auth!.user, params.assignmentId));
  });

  router.patch('/assignments/:assignmentId', ...guard, validate(update), async (req, res) => {
    const { params, body } = validated(res, update);
    res.json(await updateAssignment(db, req.auth!.user, params.assignmentId, body));
  });

  router.post('/assignments/:assignmentId/publish', ...guard, validate(one), async (req, res) => {
    const { params } = validated(res, one);
    res.json(await publishAssignment(db, req.auth!.user, params.assignmentId));
  });

  return router;
}
