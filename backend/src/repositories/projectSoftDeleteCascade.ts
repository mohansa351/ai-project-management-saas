import type { Prisma } from '@prisma/client';

/**
 * Epic 5 / Story 5.1 (AD-7): when Task and Label models exist, soft-delete live
 * children for `projectId` in this same transaction:
 *   UPDATE "Task" SET "deletedAt" = now() WHERE "projectId" = $1 AND "deletedAt" IS NULL
 *   UPDATE "Label" SET "deletedAt" = now() WHERE "projectId" = $1 AND "deletedAt" IS NULL
 * Story 4.1: no-op — do not invent Task/Label models.
 */
async function cascadeProjectSoftDeleteChildren(
  _tx: Prisma.TransactionClient | unknown,
  _projectId: string,
): Promise<void> {
  void _tx;
  void _projectId;
}

export const projectSoftDeleteCascade = {
  cascadeProjectSoftDeleteChildren,
};
