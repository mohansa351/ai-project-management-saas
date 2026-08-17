import { describe, expect, it, jest } from '@jest/globals';
import { AppError } from '../lib/http/appError.js';
import { UserRepository } from './userRepository.js';
import type { PrismaClient } from '@prisma/client';

describe('UserRepository', () => {
  it('maps Prisma P2002 to VALIDATION_ERROR without extra account fields', async () => {
    const prisma = {
      user: {
        create: jest.fn(async () => {
          const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          throw err;
        }),
      },
    } as unknown as PrismaClient;

    const repo = new UserRepository(prisma);
    await expect(
      repo.create({
        email: 'Ada@Example.com',
        passwordHash: 'hash',
        name: 'Ada',
        systemRole: 'USER',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: 'This email is already taken.',
    });

    try {
      await repo.create({
        email: 'ada@example.com',
        passwordHash: 'hash',
        name: 'Ada',
        systemRole: 'USER',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(JSON.stringify(err)).not.toMatch(/passwordHash|Ada@Example|systemRole/);
    }

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'ada@example.com',
        passwordHash: 'hash',
        name: 'Ada',
        systemRole: 'USER',
        emailVerifiedAt: null,
      },
    });
  });

  it('finds a user by id', async () => {
    const findUnique = jest.fn(async (args: { where: { id: string } }) => {
      expect(args).toEqual({ where: { id: 'user_1' } });
      return { id: 'user_1', email: 'ada@example.com' };
    });
    const prisma = { user: { findUnique } } as unknown as PrismaClient;
    const repo = new UserRepository(prisma);
    await repo.findById('user_1');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user_1' } });
  });

  it('updates password and increments sessionEpoch in one write', async () => {
    const update = jest.fn<(args: unknown) => Promise<{ id: string; sessionEpoch: number }>>(async () => ({
      id: 'user_1',
      sessionEpoch: 1,
    }));
    const prisma = { user: { update } } as unknown as PrismaClient;
    const repo = new UserRepository(prisma);
    await repo.updatePasswordAndBumpEpoch('user_1', 'new-hash');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        passwordHash: 'new-hash',
        sessionEpoch: { increment: 1 },
      },
    });
  });

  it('CAS sessionEpoch only when the expected value still matches', async () => {
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 }));
    const prisma = { user: { updateMany } } as unknown as PrismaClient;
    const repo = new UserRepository(prisma);
    await expect(repo.casSessionEpoch('user_1', 0)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', sessionEpoch: 0 },
      data: { sessionEpoch: 0 },
    });
  });

  it('CAS sessionEpoch returns 0 when the expected value no longer matches', async () => {
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 0 }));
    const prisma = { user: { updateMany } } as unknown as PrismaClient;
    const repo = new UserRepository(prisma);
    await expect(repo.casSessionEpoch('user_1', 0)).resolves.toBe(0);
  });
});
