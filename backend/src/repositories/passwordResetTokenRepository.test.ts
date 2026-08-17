import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { PasswordResetTokenRepository } from './passwordResetTokenRepository.js';

describe('PasswordResetTokenRepository', () => {
  it('findValidByHash loads by unique tokenHash and rejects used or expired rows', async () => {
    const findUnique = jest.fn<(args: { where: { tokenHash: string } }) => Promise<null>>(async () => null);
    const prisma = { passwordResetToken: { findUnique } } as unknown as PrismaClient;
    const repo = new PasswordResetTokenRepository(prisma);
    await repo.findValidByHash('abc123');
    expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: 'abc123' } });
  });

  it('markUsedIfActive claims only unused unexpired rows and reports the count', async () => {
    type UpdateManyArgs = { where: { id: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } };
    const updateMany = jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>(async () => ({ count: 1 }));
    const prisma = { passwordResetToken: { updateMany } } as unknown as PrismaClient;
    const repo = new PasswordResetTokenRepository(prisma);
    await expect(repo.markUsedIfActive('token_1')).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'token_1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('markUsedIfActive returns 0 when the token was already used', async () => {
    type UpdateManyArgs = { where: { id: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } };
    const updateMany = jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>(async () => ({ count: 0 }));
    const prisma = { passwordResetToken: { updateMany } } as unknown as PrismaClient;
    const repo = new PasswordResetTokenRepository(prisma);
    await expect(repo.markUsedIfActive('token_1')).resolves.toBe(0);
  });

  it('lockForUser acquires a transaction-scoped advisory lock keyed by userId', async () => {
    const executeRaw = jest.fn<(strings: readonly string[], ...values: unknown[]) => Promise<number>>(
      async () => 1,
    );
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const repo = new PasswordResetTokenRepository(prisma);
    await repo.lockForUser('user_123');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0];
    const [strings, ...values] = call ?? [];
    expect((strings ?? []).join('')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(values).toEqual(['user_123']);
  });

  it('invalidateUnusedForUser marks unused rows used for that user only', async () => {
    type UpdateManyArgs = { where: { userId: string; usedAt: null }; data: { usedAt: Date } };
    const updateMany = jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>(async () => ({ count: 2 }));
    const prisma = { passwordResetToken: { updateMany } } as unknown as PrismaClient;
    const repo = new PasswordResetTokenRepository(prisma);
    await repo.invalidateUnusedForUser('user_1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });
});
