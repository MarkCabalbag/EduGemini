import type { EnrollmentStatus, Role } from '@edugemini/shared';
import { AppError } from '../lib/app-error';

// The single place that decides who may do what (PRD §5.1, TRD §7.1).
// Routes and services never check roles themselves: they call `can` or `authorize`.

export type Actor = { id: string; role: Role };

/** What the caller knows about the thing being acted on. Load only what the action needs. */
export type Resource = {
  /** The instructor who owns the class. */
  classInstructorId?: string;
  /** The actor's own enrollment status in that class (for students). */
  enrollment?: EnrollmentStatus;
  /** The student who made the submission. */
  submissionStudentId?: string;
};

/** How a role must relate to the thing it acts on. */
type Access =
  | 'any' // no relationship needed
  | 'ownClass' // the instructor who owns the class
  | 'member' // a student who is approved in the class
  | 'ownSubmission'; // the student who made the submission

/** One row per row of the PRD §5.1 matrix. A role that is not listed may never do the action. */
const POLICY = {
  'class.create': { INSTRUCTOR: 'any' },
  // "View own classes and class details".
  'class.view': { INSTRUCTOR: 'ownClass', STUDENT: 'member' }, // one class
  'class.list': { INSTRUCTOR: 'any' }, // the instructor's own classes. Routes also use it as the instructors-only role check
  'class.listEnrolled': { STUDENT: 'any' }, // the student's own enrollments, whatever their status (the Enrolled list)
  'class.join': { STUDENT: 'any' },
  'class.manageMembers': { INSTRUCTOR: 'ownClass' }, // approve, decline, remove; remove a student
  'class.regenerateCode': { INSTRUCTOR: 'ownClass' }, // regenerate or disable the code
  'class.edit': { INSTRUCTOR: 'ownClass' },
  'class.archive': { INSTRUCTOR: 'ownClass', SUPER_ADMIN: 'any' },
  'class.delete': { INSTRUCTOR: 'ownClass', SUPER_ADMIN: 'any' },

  'assignment.view': { INSTRUCTOR: 'ownClass', STUDENT: 'member' }, // a student sees published assignments only: the service checks that
  'assignment.write': { INSTRUCTOR: 'ownClass' }, // create and edit
  'assignment.remove': { INSTRUCTOR: 'ownClass' }, // delete or archive
  'label.write': { INSTRUCTOR: 'ownClass' },

  'key.manage': { INSTRUCTOR: 'any' }, // the instructor's own Gemini key

  'announcement.write': { INSTRUCTOR: 'ownClass' }, // post or delete
  'announcement.view': { INSTRUCTOR: 'ownClass', STUDENT: 'member' },

  'submission.upload': { STUDENT: 'member' }, // attempts and approval are checked by the service
  'attempts.grant': { INSTRUCTOR: 'ownClass' },
  'late.allow': { INSTRUCTOR: 'ownClass' },

  'grade.viewOwn': { STUDENT: 'ownSubmission' },
  'student.viewData': { INSTRUCTOR: 'ownClass' }, // other students' individual data
  'stats.view': { INSTRUCTOR: 'ownClass', STUDENT: 'member', SUPER_ADMIN: 'any' },

  'review.approve': { INSTRUCTOR: 'ownClass' }, // edit and approve, comment, reopen
  'gradebook.view': { INSTRUCTOR: 'ownClass' }, // tracker, gradebook, CSV export

  'account.updateOwn': { STUDENT: 'any', INSTRUCTOR: 'any', SUPER_ADMIN: 'any' },
  'account.deleteOwn': { STUDENT: 'any', INSTRUCTOR: 'any' },
  'account.moderate': { SUPER_ADMIN: 'any' }, // suspend, reinstate, delete accounts
  'health.view': { SUPER_ADMIN: 'any' },
} as const satisfies Record<string, Partial<Record<Role, Access>>>;

export type Action = keyof typeof POLICY;

/** `pending` is a student waiting for approval: the UI shows "Pending approval" instead of "not found". */
export type Decision = 'allow' | 'not_found' | 'pending';

export function decide(actor: Actor, action: Action, resource: Resource = {}): Decision {
  const access = (POLICY[action] as Partial<Record<Role, Access>>)[actor.role];

  switch (access) {
    case undefined:
      return 'not_found'; // wrong role: the route's existence is not revealed (API Spec A3)
    case 'any':
      return 'allow';
    case 'ownClass':
      return resource.classInstructorId === actor.id ? 'allow' : 'not_found';
    case 'ownSubmission':
      return resource.submissionStudentId === actor.id ? 'allow' : 'not_found';
    case 'member':
      if (resource.enrollment === 'ACTIVE') return 'allow';
      return resource.enrollment === 'PENDING' ? 'pending' : 'not_found'; // declined and removed look like no class
  }
}

/** True when the actor may do this. Use it to decide what to show or include. */
export function can(actor: Actor, action: Action, resource?: Resource): boolean {
  return decide(actor, action, resource) === 'allow';
}

/** Throws when the actor may not. No relationship means NOT_FOUND, the same as a missing item. */
export function authorize(actor: Actor, action: Action, resource?: Resource): void {
  const decision = decide(actor, action, resource);
  if (decision === 'pending') throw new AppError('ENROLLMENT_PENDING');
  if (decision === 'not_found') throw new AppError('NOT_FOUND');
}
