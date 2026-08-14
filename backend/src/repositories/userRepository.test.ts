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
});
