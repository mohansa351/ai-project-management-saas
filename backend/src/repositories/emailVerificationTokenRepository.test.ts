import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { EmailVerificationTokenRepository } from './emailVerificationTokenRepository.js';

describe('EmailVerificationTokenRepository', () => {
  type FindFirstArgs = { where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } } };
  type UpdateManyArgs = { where: { id?: string; userId?: string; consumedAt: null }; data: { consumedAt: Date } };

  it('findValidByHash queries only unconsumed, unexpired tokens matching the hash', async () => {
    const findFirst = jest.fn<(args: FindFirstArgs) => Promise<null>>(async () => null);
    const prisma = {
      emailVerificationToken: { findFirst },
    } as unknown as PrismaClient;
    const repo = new EmailVerificationTokenRepository(prisma);

    const before = Date.now();
    await repo.findValidByHash('abc123');
    const after = Date.now();

    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0]?.[0] as FindFirstArgs;
    expect(args.where.tokenHash).toBe('abc123');
    expect(args.where.consumedAt).toBeNull();
    // The "gt" cutoff must be "now": a consumed token is filtered out by consumedAt: null,
    // and an expired token is filtered out because its expiresAt is not greater than now.
    expect(args.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.where.expiresAt.gt.getTime()).toBeLessThanOrEqual(after);
  });

  it('markConsumedIfActive only claims a token that is still unconsumed and reports the affected row count', async () => {
    const updateMany = jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>(
      async () => ({ count: 1 }),
    );
    const prisma = {
      emailVerificationToken: { updateMany },
    } as unknown as PrismaClient;
    const repo = new EmailVerificationTokenRepository(prisma);

    const count = await repo.markConsumedIfActive('token_1');

    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'token_1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('markConsumedIfActive returns 0 when the token was already consumed (lost the race)', async () => {
    const updateMany = jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>(
      async () => ({ count: 0 }),
    );
    const prisma = {
      emailVerificationToken: { updateMany },
    } as unknown as PrismaClient;
    const repo = new EmailVerificationTokenRepository(prisma);

    await expect(repo.markConsumedIfActive('token_1')).resolves.toBe(0);
  });

  it('lockForIssuance acquires a transaction-scoped advisory lock keyed by userId', async () => {
    const executeRaw = jest.fn<(strings: readonly string[], ...values: unknown[]) => Promise<number>>(
      async () => 1,
    );
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const repo = new EmailVerificationTokenRepository(prisma);

    await repo.lockForIssuance('user_123');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0];
    expect(call).toBeDefined();
    const [strings, ...values] = call ?? [];
    expect((strings ?? []).join('')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(values).toEqual(['user_123']);
  });
});
