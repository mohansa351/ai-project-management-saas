import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { RefreshTokenRepository } from './refreshTokenRepository.js';

describe('RefreshTokenRepository', () => {
  it('creates a hashed row and revokes only live unexpired hashes', async () => {
    const create = jest.fn(async (args: { data: unknown }) => ({ id: 'rt_1', ...((args.data as object) ?? {}) }));
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 }));
    const prisma = {
      refreshToken: { create, updateMany },
    } as unknown as PrismaClient;
    const repo = new RefreshTokenRepository(prisma);

    await repo.create({
      userId: 'user_1',
      tokenHash: 'abc',
      expiresAt: new Date('2026-08-21T00:00:00.000Z'),
      userAgent: 'jest',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        tokenHash: 'abc',
        expiresAt: new Date('2026-08-21T00:00:00.000Z'),
        userAgent: 'jest',
      },
    });

    const count = await repo.revokeByHash('abc');
    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: 'abc',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
