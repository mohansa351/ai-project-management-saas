import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient, RefreshToken } from '@prisma/client';
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
        replacedByHash: null,
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

  it('claims a live hash by setting revokedAt and replacedByHash', async () => {
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 }));
    const prisma = { refreshToken: { updateMany } } as unknown as PrismaClient;
    const repo = new RefreshTokenRepository(prisma);
    const count = await repo.claimRotation('old-hash', 'new-hash');
    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: 'old-hash',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        revokedAt: expect.any(Date),
        replacedByHash: 'new-hash',
      },
    });
  });

  it('revokes only the live leaf of a rotated chain, not an independent session', async () => {
    const t1: RefreshToken = {
      id: '1',
      userId: 'user_1',
      tokenHash: 'h1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      revokedAt: new Date('2026-08-17T00:00:00.000Z'),
      replacedByHash: 'h2',
      userAgent: null,
      createdAt: new Date(),
    };
    const t2: RefreshToken = {
      ...t1,
      id: '2',
      tokenHash: 'h2',
      replacedByHash: 'h3',
    };
    const t3: RefreshToken = {
      ...t1,
      id: '3',
      tokenHash: 'h3',
      revokedAt: null,
      replacedByHash: null,
    };
    const independent: RefreshToken = {
      ...t1,
      id: '9',
      tokenHash: 'other',
      revokedAt: null,
      replacedByHash: null,
    };
    const byHash = new Map([
      ['h1', t1],
      ['h2', t2],
      ['h3', t3],
      ['other', independent],
    ]);
    const updateMany = jest.fn<(args: { where: { tokenHash: string } }) => Promise<{ count: number }>>(
      async (args) => ({ count: args.where.tokenHash === 'h3' ? 1 : 0 }),
    );
    const prisma = {
      refreshToken: {
        findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => byHash.get(where.tokenHash) ?? null),
        updateMany,
      },
    } as unknown as PrismaClient;
    const repo = new RefreshTokenRepository(prisma);
    const leaf = await repo.revokeLiveLeafOfChain(t1);
    expect(leaf).toBe('h3');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]?.[0].where.tokenHash).toBe('h3');
  });

  it('locks rotation by token hash via advisory lock', async () => {
    const executeRaw = jest.fn(async () => 1);
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const repo = new RefreshTokenRepository(prisma);
    await repo.lockForRotation('presented-hash');
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
