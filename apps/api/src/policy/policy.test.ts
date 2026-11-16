import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/app-error';
import { authorize, can, decide, type Action, type Actor, type Resource } from './policy';

// Every action against every kind of caller, as data (TRD §7.2). The expected lists come from PRD §5.1.
// All scenarios are about one class owned by instructor "i1" and one submission made by student "s1".

type Caller = { actor: Actor; resource: Resource };
const CLASS = { classInstructorId: 'i1', submissionStudentId: 's1' } as const;

const callers = {
  ownerInstructor: { actor: { id: 'i1', role: 'INSTRUCTOR' }, resource: CLASS },
  otherInstructor: { actor: { id: 'i2', role: 'INSTRUCTOR' }, resource: CLASS },
  activeStudent: { actor: { id: 's1', role: 'STUDENT' }, resource: { ...CLASS, enrollment: 'ACTIVE' } },
  otherActiveStudent: { actor: { id: 's2', role: 'STUDENT' }, resource: { ...CLASS, enrollment: 'ACTIVE' } },
  pendingStudent: { actor: { id: 's3', role: 'STUDENT' }, resource: { ...CLASS, enrollment: 'PENDING' } },
  declinedStudent: { actor: { id: 's4', role: 'STUDENT' }, resource: { ...CLASS, enrollment: 'DECLINED' } },
  removedStudent: { actor: { id: 's5', role: 'STUDENT' }, resource: { ...CLASS, enrollment: 'REMOVED' } },
  nonMemberStudent: { actor: { id: 's6', role: 'STUDENT' }, resource: CLASS },
  admin: { actor: { id: 'a1', role: 'SUPER_ADMIN' }, resource: CLASS },
} satisfies Record<string, Caller>;

type CallerName = keyof typeof callers;

const approvedStudents: CallerName[] = ['activeStudent', 'otherActiveStudent'];
const everyone = Object.keys(callers) as CallerName[];

/** Who may do each action. Adding an action to the policy without adding it here is a type error. */
const allowed: Record<Action, CallerName[]> = {
  'class.create': ['ownerInstructor', 'otherInstructor'],
  'class.view': ['ownerInstructor', ...approvedStudents],
  'class.list': ['ownerInstructor', 'otherInstructor'],
  'class.listEnrolled': [...approvedStudents, 'pendingStudent', 'declinedStudent', 'removedStudent', 'nonMemberStudent'], // any student
  'class.join': [...approvedStudents, 'pendingStudent', 'declinedStudent', 'removedStudent', 'nonMemberStudent'],
  'class.manageMembers': ['ownerInstructor'],
  'class.regenerateCode': ['ownerInstructor'],
  'class.edit': ['ownerInstructor'],
  'class.archive': ['ownerInstructor', 'admin'],
  'class.delete': ['ownerInstructor', 'admin'],
  'assignment.view': ['ownerInstructor', ...approvedStudents],
  'assignment.write': ['ownerInstructor'],
  'assignment.remove': ['ownerInstructor'],
  'label.write': ['ownerInstructor'],
  'key.manage': ['ownerInstructor', 'otherInstructor'],
  'announcement.write': ['ownerInstructor'],
  'announcement.view': ['ownerInstructor', ...approvedStudents],
  'submission.upload': approvedStudents,
  'attempts.grant': ['ownerInstructor'],
  'late.allow': ['ownerInstructor'],
  'grade.viewOwn': ['activeStudent'], // only the student who made the submission
  'student.viewData': ['ownerInstructor'], // not other students, not the Super Admin
  'stats.view': ['ownerInstructor', ...approvedStudents, 'admin'],
  'review.approve': ['ownerInstructor'],
  'gradebook.view': ['ownerInstructor'],
  'account.updateOwn': everyone,
  'account.deleteOwn': everyone.filter((name) => name !== 'admin'),
  'account.moderate': ['admin'],
  'health.view': ['admin'],
};

const rows = (Object.keys(allowed) as Action[]).flatMap((action) =>
  everyone.map((name) => ({ action, name, expected: allowed[action].includes(name) })),
);

describe('permission matrix (PRD §5.1)', () => {
  it.each(rows)('$action as $name: allowed = $expected', ({ action, name, expected }) => {
    const { actor, resource } = callers[name];
    expect(can(actor, action, resource)).toBe(expected);
  });
});

describe('what a denial looks like', () => {
  it('is NOT_FOUND for no relationship, so the item cannot be told apart from a missing one', () => {
    const { actor, resource } = callers.otherInstructor;
    expect(() => authorize(actor, 'class.edit', resource)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('is NOT_FOUND for the wrong role, so admin routes do not reveal themselves', () => {
    const { actor } = callers.activeStudent;
    expect(() => authorize(actor, 'account.moderate')).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('is ENROLLMENT_PENDING for a pending student, so the UI can show "Pending approval"', () => {
    const { actor, resource } = callers.pendingStudent;
    expect(decide(actor, 'announcement.view', resource)).toBe('pending');
    expect(() => authorize(actor, 'announcement.view', resource)).toThrowError(AppError);
    expect(() => authorize(actor, 'announcement.view', resource)).toThrowError(
      expect.objectContaining({ code: 'ENROLLMENT_PENDING' }),
    );
  });

  it('treats declined and removed students like strangers', () => {
    for (const name of ['declinedStudent', 'removedStudent', 'nonMemberStudent'] as const) {
      const { actor, resource } = callers[name];
      expect(decide(actor, 'announcement.view', resource)).toBe('not_found');
    }
  });

  it('allows silently when permitted', () => {
    const { actor, resource } = callers.ownerInstructor;
    expect(() => authorize(actor, 'class.edit', resource)).not.toThrow();
  });

  it('never lets a missing resource count as ownership', () => {
    expect(can({ id: 'i1', role: 'INSTRUCTOR' }, 'class.edit')).toBe(false);
  });
});
