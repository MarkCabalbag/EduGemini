import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssignmentStatusSchema,
  EnrollmentStatusSchema,
  FileStatusSchema,
  NotificationTypeSchema,
  RoleSchema,
  ScoringFormatSchema,
  VersionStatusSchema,
} from './enums';

const prisma = readFileSync(resolve(__dirname, '../../../apps/api/prisma/schema.prisma'), 'utf8').replace(/\r\n/g, '\n');

/** The values of `enum <name> { ... }` in schema.prisma. */
function prismaEnum(name: string): string[] {
  const body = prisma.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe('shared enums match Prisma', () => {
  it('Role', () => expect(RoleSchema.options).toEqual(prismaEnum('Role')));
  it('EnrollmentStatus', () => expect(EnrollmentStatusSchema.options).toEqual(prismaEnum('EnrollmentStatus')));
  it('AssignmentStatus', () => expect(AssignmentStatusSchema.options).toEqual(prismaEnum('AssignmentStatus')));
  it('ScoringFormat', () => expect(ScoringFormatSchema.options).toEqual(prismaEnum('ScoringFormat')));
  it('VersionStatus', () => expect(VersionStatusSchema.options).toEqual(prismaEnum('VersionStatus')));
  it('FileStatus', () => expect(FileStatusSchema.options).toEqual(prismaEnum('FileStatus')));
  it('NotificationType', () => expect(NotificationTypeSchema.options).toEqual(prismaEnum('NotificationType')));
});
